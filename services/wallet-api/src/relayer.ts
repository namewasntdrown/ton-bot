import axios from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import { Address, ContractProvider, Sender, toNano } from '@ton/core';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import {
  Asset,
  Factory,
  JettonRoot,
  JettonWallet,
  Pool,
  PoolType,
  VaultJetton,
  VaultNative,
  MAINNET_FACTORY_ADDR,
} from '@dedust/sdk';
import { decryptMnemonic } from './crypto';
import {
  SwapOrderRow,
  claimNextSwapOrder,
  getWalletSecretById,
  updateSwapOrderStatus,
} from './db';

type SwapRelayerOptions = {
  masterKey: Buffer;
  tonEndpoint: string;
  tonApiKey?: string;
  dedustApiUrl?: string;
  logger: FastifyBaseLogger;
};

type WalletSecretRow = {
  id: number;
  user_id: number;
  address: string;
  encrypted_mnemonic: string;
};

type WalletRuntime = {
  wallet: WalletContractV4;
  address: Address;
  sender: Sender;
  provider: ContractProvider;
};

type DedustAsset = {
  type?: 'native' | 'jetton';
  address?: string;
  decimals?: number;
  source?: { address?: string };
};

export class SwapRelayer {
  private readonly client: TonClient;
  private readonly factory: Factory;
  private readonly factoryProvider: ContractProvider;
  private readonly nativeAsset = Asset.native();
  private readonly dedustApiUrl: string;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  private nativeVault?: VaultNative;
  private readonly jettonVaultCache = new Map<
    string,
    { vault: VaultJetton; provider: ContractProvider }
  >();
  private readonly poolCache = new Map<
    string,
    { pool: Pool; provider: ContractProvider }
  >();
  private readonly assetCache = {
    fetchedAt: 0,
    map: new Map<string, DedustAsset>(),
  };
  private readonly pow10Cache = new Map<number, bigint>();

  private readonly idleDelayMs = 2_000;
  private readonly errorDelayMs = 5_000;
  private readonly swapDeadlineSeconds = 120;
  private readonly nativeSwapGas = toNano('0.2');
  private readonly jettonForwardTon = toNano('0.15');
  private readonly jettonTransferValue = toNano('0.25');

  constructor(private readonly options: SwapRelayerOptions) {
    this.client = new TonClient({
      endpoint: options.tonEndpoint,
      apiKey: options.tonApiKey,
    });
    this.factory = Factory.createFromAddress(MAINNET_FACTORY_ADDR);
    this.factoryProvider = this.client.provider(this.factory.address);
    this.dedustApiUrl = options.dedustApiUrl || 'https://api.dedust.io';
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
    this.options.logger.info('swap relayer started');
  }

  async stop() {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.options.logger.info('swap relayer stopped');
  }

  private async runLoop() {
    while (this.running) {
      try {
        const order = await claimNextSwapOrder();
        if (!order) {
          await this.delay(this.idleDelayMs);
          continue;
        }
        await this.processOrder(order);
      } catch (err) {
        this.options.logger.error(
          { err: err instanceof Error ? err.message : err },
          'relayer_loop_error'
        );
        await this.delay(this.errorDelayMs);
      }
    }
  }

  private async processOrder(order: SwapOrderRow) {
    try {
      this.options.logger.info(
        { orderId: order.id, direction: order.direction },
        'processing_swap_order'
      );
      const wallet = await this.loadWallet(order);
      if (order.direction === 'buy') {
        await this.executeBuy(order, wallet);
      } else {
        await this.executeSell(order, wallet);
      }
      await updateSwapOrderStatus(order.id, 'completed', { tx_hash: null });
      this.options.logger.info(
        { orderId: order.id },
        'swap_order_completed'
      );
    } catch (err: any) {
      const message = this.formatError(err);
      this.options.logger.error(
        { orderId: order.id, err: message },
        'swap_order_failed'
      );
      await updateSwapOrderStatus(order.id, 'failed', {
        error: message,
      });
    }
  }

  private async executeBuy(order: SwapOrderRow, wallet: WalletRuntime) {
    const tonAmountNano = this.parseTonAmount(order.ton_amount);
    if (tonAmountNano <= 0n) {
      throw new Error('invalid_ton_amount');
    }

    const walletBalance = await this.client.getBalance(wallet.address);
    if (walletBalance < tonAmountNano + this.nativeSwapGas) {
      throw new Error('insufficient_ton_balance');
    }

    const tokenAddress = this.parseAddress(order.token_address);
    const poolCtx = await this.getPoolContext(tokenAddress);
    const estimation = await poolCtx.pool.getEstimatedSwapOut(
      poolCtx.provider,
      {
        assetIn: this.nativeAsset,
        amountIn: tonAmountNano,
      }
    );
    if (estimation.amountOut <= 0n) {
      throw new Error('zero_amount_out');
    }

    let minOut: bigint | undefined;
    const limitStr = order.limit_price?.trim();
    if (limitStr) {
      const limitNano = this.parseTonAmount(limitStr);
      if (limitNano <= 0n) {
        throw new Error('invalid_limit_price');
      }
      const decimals = await this.getAssetDecimals(tokenAddress);
      const factor = this.pow10(decimals);
      minOut = (tonAmountNano * factor) / limitNano;
      if (minOut <= 0n) {
        throw new Error('limit_too_strict');
      }
      if (estimation.amountOut < minOut) {
        throw new Error('price_exceeds_limit');
      }
    }

    const nativeVault = await this.getNativeVault();
    const provider = this.client.provider(nativeVault.address);
    await nativeVault.sendSwap(provider, wallet.sender, {
      amount: tonAmountNano,
      poolAddress: poolCtx.pool.address,
      limit: minOut,
      swapParams: {
        deadline: Math.floor(Date.now() / 1000) + this.swapDeadlineSeconds,
        recipientAddress: wallet.address,
      },
      gasAmount: this.nativeSwapGas,
    });
  }

  private async executeSell(order: SwapOrderRow, wallet: WalletRuntime) {
    const percentRaw = order.sell_percent?.trim();
    if (!percentRaw) {
      throw new Error('missing_sell_percent');
    }

    const tokenAddress = this.parseAddress(order.token_address);
    const jettonWalletCtx = await this.getJettonWallet(wallet.address, tokenAddress);
    const jettonBalance = await this.safeGetJettonBalance(jettonWalletCtx.wallet, jettonWalletCtx.provider);
    if (jettonBalance <= 0n) {
      throw new Error('jetton_balance_zero');
    }

    const jettonAmount = this.takePercentAmount(jettonBalance, percentRaw);
    if (jettonAmount <= 0n) {
      throw new Error('amount_too_small');
    }

    const walletBalance = await this.client.getBalance(wallet.address);
    if (walletBalance < this.jettonTransferValue) {
      throw new Error('insufficient_ton_for_fees');
    }

    const poolCtx = await this.getPoolContext(tokenAddress);
    const jettonVaultCtx = await this.getJettonVault(tokenAddress);
    const payload = VaultJetton.createSwapPayload({
      poolAddress: poolCtx.pool.address,
      limit: 0n,
      swapParams: {
        deadline: Math.floor(Date.now() / 1000) + this.swapDeadlineSeconds,
        recipientAddress: wallet.address,
      },
    });

    await jettonWalletCtx.wallet.sendTransfer(
      jettonWalletCtx.provider,
      wallet.sender,
      this.jettonTransferValue,
      {
        amount: jettonAmount,
        destination: jettonVaultCtx.vault.address,
        responseAddress: wallet.address,
        forwardAmount: this.jettonForwardTon,
        forwardPayload: payload,
      }
    );
  }

  private async loadWallet(order: SwapOrderRow): Promise<WalletRuntime> {
    const row = (await getWalletSecretById(order.wallet_id)) as WalletSecretRow | null;
    if (!row || Number(row.user_id) !== Number(order.user_id)) {
      throw new Error('wallet_not_found');
    }
    const mnemonic = decryptMnemonic(this.options.masterKey, row.encrypted_mnemonic);
    const words = mnemonic.trim().split(/\s+/);
    const { publicKey, secretKey } = await mnemonicToPrivateKey(words);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey });
    const provider = this.client.provider(wallet.address, wallet.init);
    const sender = wallet.sender(provider, secretKey);

    try {
      const stored = this.parseAddress(row.address);
      const actual = wallet.address.toString({ bounceable: false });
      if (stored.toString({ bounceable: false }) !== actual) {
        this.options.logger.warn(
          { walletId: order.wallet_id },
          'wallet_address_mismatch_detected'
        );
      }
    } catch {
      // ignore mismatch errors
    }

    return { wallet, sender, address: wallet.address, provider };
  }

  private parseTonAmount(value?: string | null): bigint {
    const normalized = value?.trim();
    if (!normalized) {
      return 0n;
    }
    try {
      return toNano(normalized);
    } catch {
      throw new Error('invalid_ton_value');
    }
  }

  private parseAddress(raw: string): Address {
    try {
      return Address.parse(raw);
    } catch {
      throw new Error('invalid_token_address');
    }
  }

  private async getNativeVault(): Promise<VaultNative> {
    if (!this.nativeVault) {
      this.nativeVault = await this.factory.getNativeVault(this.factoryProvider);
    }
    return this.nativeVault;
  }

  private poolCacheKey(tokenAddress: Address) {
    return tokenAddress.toString({ bounceable: true });
  }

  private async getPoolContext(tokenAddress: Address) {
    const key = this.poolCacheKey(tokenAddress);
    const cached = this.poolCache.get(key);
    if (cached) return cached;

    const jettonAsset = Asset.jetton(tokenAddress);
    const assets = this.sortAssets(this.nativeAsset, jettonAsset);
    const pool = await this.factory.getPool(this.factoryProvider, PoolType.VOLATILE, assets);
    const provider = this.client.provider(pool.address);
    const ctx = { pool, provider };
    this.poolCache.set(key, ctx);
    return ctx;
  }

  private async getJettonVault(tokenAddress: Address) {
    const key = tokenAddress.toString({ bounceable: true });
    const cached = this.jettonVaultCache.get(key);
    if (cached) return cached;
    const vault = await this.factory.getJettonVault(this.factoryProvider, tokenAddress);
    const provider = this.client.provider(vault.address);
    const ctx = { vault, provider };
    this.jettonVaultCache.set(key, ctx);
    return ctx;
  }

  private sortAssets(a: Asset, b: Asset): [Asset, Asset] {
    return a.toString() < b.toString() ? [a, b] : [b, a];
  }

  private async getJettonWallet(owner: Address, jettonRootAddress: Address) {
    const root = JettonRoot.createFromAddress(jettonRootAddress);
    const rootProvider = this.client.provider(root.address);
    const walletAddress = await root.getWalletAddress(rootProvider, owner);
    const wallet = JettonWallet.createFromAddress(walletAddress);
    const provider = this.client.provider(wallet.address);
    return { wallet, provider };
  }

  private async safeGetJettonBalance(wallet: JettonWallet, provider: ContractProvider) {
    try {
      return await wallet.getBalance(provider);
    } catch {
      return 0n;
    }
  }

  private takePercentAmount(balance: bigint, percentRaw: string): bigint {
    const normalized = percentRaw.trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new Error('invalid_percent');
    }
    const [intPart, fracPart = ''] = normalized.split('.');
    const numerator = BigInt(intPart + fracPart);
    const denominator = 10n ** BigInt(fracPart.length || 0);
    if (numerator <= 0n) {
      throw new Error('invalid_percent');
    }
    if (numerator > denominator * 100n) {
      throw new Error('invalid_percent');
    }
    const amount = (balance * numerator) / (denominator * 100n);
    if (amount <= 0n) {
      return balance > 0n ? 1n : 0n;
    }
    return amount;
  }

  private pow10(decimals: number): bigint {
    let cached = this.pow10Cache.get(decimals);
    if (cached) return cached;
    let result = 1n;
    for (let i = 0; i < decimals; i++) {
      result *= 10n;
    }
    this.pow10Cache.set(decimals, result);
    return result;
  }

  private async getAssetDecimals(address: Address): Promise<number> {
    await this.ensureAssetCache();
    const key = address.toString({ bounceable: true });
    const asset = this.assetCache.map.get(key);
    if (asset?.decimals !== undefined) {
      return Number(asset.decimals) || 9;
    }
    return 9;
  }

  private async ensureAssetCache(force = false) {
    if (
      !force &&
      this.assetCache.map.size &&
      Date.now() - this.assetCache.fetchedAt < 5 * 60_000
    ) {
      return;
    }
    try {
      const { data } = await axios.get<DedustAsset[]>(
        `${this.dedustApiUrl}/v2/assets`,
        { timeout: 15_000 }
      );
      const map = new Map<string, DedustAsset>();
      for (const asset of Array.isArray(data) ? data : []) {
        const addr = asset.address || asset.source?.address;
        if (addr) {
          map.set(addr, asset);
        }
      }
      if (map.size) {
        this.assetCache.map = map;
        this.assetCache.fetchedAt = Date.now();
      }
    } catch (err) {
      this.options.logger.warn(
        { err: err instanceof Error ? err.message : err },
        'dedust_asset_fetch_failed'
      );
    }
  }

  private formatError(err: any): string {
    const message =
      err?.message ||
      err?.code ||
      (typeof err === 'string' ? err : 'unknown_error');
    return String(message).slice(0, 240);
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
