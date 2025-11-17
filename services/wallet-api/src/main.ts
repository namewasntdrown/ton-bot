// services/wallet-api/src/main.ts
import 'dotenv/config';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import {
  migrate,
  listWalletsByUser,
  countWalletsByUser,
  insertWallet,
  getWalletById,
  getWalletSecretById,
  listAllUserWallets,
  getTradingProfile,
  upsertTradingProfile,
  insertSwapOrder,
  upsertUserPosition,
  deleteWalletById,
  createCopytradeProfile,
  listCopytradeProfilesByUser,
  updateCopytradeProfile,
  replaceCopytradeProfileWallets,
  listCopytradeProfilesBySource,
  listActiveCopytradeSources,
} from './db';
import { encryptMnemonic, decryptMnemonic } from './crypto';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, Address, internal, toNano, beginCell, TonClient, SendMode } from '@ton/ton';
import { SwapRelayer } from './relayer';
import { fanoutCopytradeOrder, fanoutCopytradeSignal } from './copytrade';
import { registerPositionRoutes } from './routes/positions';
import { asBooleanFlag } from './utils/flags';

// MASTER parsing with prefixes
const raw = process.env.MASTER_KEY_DEV || '';
if (!raw) {
  // fastify logger not ready yet; warn after app init as well
  console.warn('MASTER_KEY_DEV is not set. Wallet encryption will fail.');
}
const MASTER = raw
  ? (raw.startsWith('base64:')
      ? Buffer.from(raw.slice(7), 'base64')
      : raw.startsWith('hex:')
      ? Buffer.from(raw.slice(4), 'hex')
      : Buffer.from(raw, 'base64'))
  : null;

const PORT = Number(process.env.PORT || 8090);
// Default to mainnet unless overridden by env
const TON_RPC = process.env.TON_RPC_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
const TON_API_KEY = process.env.TONCENTER_API_KEY || undefined;
const SELL_MIN_TON_FOR_SELL_STR = process.env.SELL_MIN_TON_FOR_SELL || '0.26';
const SELL_MIN_TON_FOR_SELL_NANO = toNano(SELL_MIN_TON_FOR_SELL_STR);
const COPYTRADE_PLATFORM_VALUES = ['stonfi', 'dedust', 'tonfun', 'gaspump', 'memeslab', 'blum'] as const;
type CopytradePlatform = (typeof COPYTRADE_PLATFORM_VALUES)[number];
const tonClient = new TonClient({ endpoint: TON_RPC, apiKey: TON_API_KEY });

function nanoToTonString(n: bigint) {
  const s = n.toString();
  if (s.length <= 9) {
    const frac = s.padStart(9, '0');
    return ('0.' + frac).replace(/\.0+$/, '').replace(/\.$/, '');
  }
  const int = s.slice(0, -9);
  const frac = s.slice(-9).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

async function deriveTonAddress(wordsArr: string[]) {
  const { publicKey } = await mnemonicToPrivateKey(wordsArr);
  const wc = WalletContractV4.create({ workchain: 0, publicKey });
  // Return non-bounceable to avoid deposit bounces to undeployed wallets
  return wc.address.toString({ bounceable: false } as any);
}

function addressVariants(addr: string) {
  const a = Address.parse(addr);
  return {
    bounceable: a.toString({ bounceable: true } as any),
    non_bounceable: a.toString({ bounceable: false } as any),
  };
}

function normalizeFriendlyAddress(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = Address.parseFriendly(trimmed);
    return parsed.address.toString({ bounceable: false, urlSafe: true });
  } catch {
    try {
      return Address.parse(trimmed).toString({ bounceable: false, urlSafe: true });
    } catch {
      return null;
    }
  }
}

async function loadCopytradeProfile(userId: number, profileId: number) {
  const profiles = await listCopytradeProfilesByUser(userId);
  return profiles.find((p) => p.id === profileId) || null;
}

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  const hydrateBalances = async (
    rows: { id: number; address: string }[]
  ): Promise<
    Array<
      {
        id: number;
        address: string;
        balance_nton?: string | null;
        balance_ton?: string | null;
      } & Record<string, any>
    >
  > => {
    if (!rows.length) return rows as any;
    return Promise.all(
      rows.map(async (row) => {
        try {
          const balance = await tonClient.getBalance(Address.parse(row.address));
          return {
            ...row,
            balance_nton: balance.toString(),
            balance_ton: nanoToTonString(balance),
          };
        } catch (err: any) {
          app.log.warn(
            { msg: err?.message, walletId: row.id, address: row.address },
            'wallet_balance_fetch_failed'
          );
          return { ...row, balance_nton: null, balance_ton: null };
        }
      })
    );
  };
  const relayer =
    MASTER && MASTER.length === 32
      ? new SwapRelayer({
          masterKey: MASTER,
          tonEndpoint: TON_RPC,
          tonApiKey: TON_API_KEY,
          dedustApiUrl: process.env.DEDUST_API_BASE_URL,
          logger: app.log,
        })
      : null;

  app.get('/health', async () => ({ ok: true }));

  // Diagnostics: reveal current TON RPC and API key presence
  app.get('/diag', async () => ({ endpoint: TON_RPC, apiKeySet: Boolean(TON_API_KEY) }));

  app.addHook('onReady', async () => {
    await migrate();
    if (!MASTER || MASTER.length !== 32) {
      app.log.warn('MASTER_KEY_DEV missing or invalid length (need 32 bytes).');
    }
    if (relayer) {
      relayer.start();
    }
  });
  registerPositionRoutes(app);

  app.addHook('onClose', async () => {
    if (relayer) {
      await relayer.stop();
    }
  });

  // GET /wallets?user_id=...
  const QueryUserId = z.object({ user_id: z.coerce.number().int().nonnegative() });
  const CreateWalletDto = z.object({ user_id: z.coerce.number().int().nonnegative() });
  const DeleteWalletDto = z.object({ user_id: z.coerce.number().int().nonnegative() });
  const TradingProfileDto = z.object({
    user_id: z.coerce.number().int().nonnegative(),
    active_wallet_id: z.coerce.number().int().positive().optional(),
    ton_amount: z.coerce.number().positive().optional(),
    buy_limit_price: z.coerce.number().positive().optional(),
    sell_percent: z.coerce.number().positive().optional(),
    trade_mode: z.enum(['buy', 'sell']).optional(),
    last_token: z.string().trim().optional(),
  });
  const PositionHintDto = z.object({
    token_amount: z.coerce.number().positive(),
    token_price_ton: z.coerce.number().positive().optional(),
    token_price_usd: z.coerce.number().positive().optional(),
    token_symbol: z.string().trim().max(64).optional(),
    token_name: z.string().trim().max(128).optional(),
    token_image: z.string().trim().max(512).optional(),
  });
  const CopytradeProfileCreateDto = z.object({
    user_id: z.coerce.number().int().nonnegative(),
  });
  const CopytradePlatformEnum = z.enum(COPYTRADE_PLATFORM_VALUES);
  const CopytradeProfileUpdateDto = z.object({
    user_id: z.coerce.number().int().nonnegative(),
    source_address: z.string().trim().min(48).max(66).optional(),
    name: z.string().trim().max(64).optional(),
    smart_mode: z.boolean().optional(),
    manual_amount_ton: z.coerce.number().positive().optional(),
    slippage_percent: z.coerce.number().positive().optional(),
    copy_buy: z.boolean().optional(),
    copy_sell: z.boolean().optional(),
    platforms: z
      .array(CopytradePlatformEnum)
      .max(COPYTRADE_PLATFORM_VALUES.length)
      .optional(),
    status: z.enum(['idle', 'running']).optional(),
  });
  const CopytradeWalletsDto = z.object({
    user_id: z.coerce.number().int().nonnegative(),
    wallet_ids: z
      .array(z.coerce.number().int().positive())
      .max(10)
      .optional(),
  });
  const CopytradeSignalDto = z.object({
    source_address: z.string().trim().min(48).max(66),
    direction: z.enum(['buy', 'sell']),
    token_address: z.string().trim().min(48).max(66),
    ton_amount: z.coerce.number().positive(),
    limit_price: z.coerce.number().positive().optional(),
    sell_percent: z.coerce.number().positive().optional(),
    platform: CopytradePlatformEnum.optional(),
  });
  const SwapRequestDto = z.object({
    user_id: z.coerce.number().int().nonnegative(),
    wallet_id: z.coerce.number().int().positive(),
    token_address: z.string().min(10),
    direction: z.enum(['buy', 'sell']),
    ton_amount: z.coerce.number().positive(),
    limit_price: z.coerce.number().positive().optional(),
    sell_percent: z.coerce.number().positive().optional(),
    position_hint: PositionHintDto.optional(),
  });

  app.get('/wallets', async (req, reply) => {
    try {
      const query = (req.query ?? {}) as any;
      const { user_id } = QueryUserId.parse(query);
      const userId = user_id;
      const includeBalance = asBooleanFlag(query?.with_balance ?? query?.include_balance);

      const rows = await listWalletsByUser(userId);
      if (!rows.length || !includeBalance) {
        return reply.send(rows);
      }

      const enriched = await hydrateBalances(rows);

      return reply.send(enriched);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /wallets error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.get('/trading/profile', async (req, reply) => {
    try {
      const { user_id } = QueryUserId.parse((req.query ?? {}) as any);
      const [profile, walletsRaw] = await Promise.all([
        getTradingProfile(user_id),
        listWalletsByUser(user_id),
      ]);
      const wallets = await hydrateBalances(walletsRaw);
      return reply.send({ profile, wallets });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /trading/profile error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.post('/trading/profile', async (req, reply) => {
    try {
      const payload = TradingProfileDto.parse((req.body ?? {}) as any);
      if (payload.active_wallet_id) {
        const walletRow = await getWalletById(payload.active_wallet_id);
        if (!walletRow || walletRow.user_id !== payload.user_id) {
          return reply.code(404).send({ error: 'wallet_not_found' });
        }
      }
      const updated = await upsertTradingProfile({
        user_id: payload.user_id,
        active_wallet_id: payload.active_wallet_id ?? null,
        ton_amount: payload.ton_amount ?? null,
        buy_limit_price: payload.buy_limit_price ?? null,
        sell_percent: payload.sell_percent ?? null,
        trade_mode: payload.trade_mode ?? null,
        last_token: payload.last_token ?? null,
      });
      return reply.send(updated);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /trading/profile error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.post('/swap', async (req, reply) => {
    try {
      const payload = SwapRequestDto.parse((req.body ?? {}) as any);
      const walletRow = await getWalletById(payload.wallet_id);
      if (!walletRow || walletRow.user_id !== payload.user_id) {
        return reply.code(404).send({ error: 'wallet_not_found' });
      }
      if (payload.direction === 'sell') {
        let balance: bigint;
        try {
          balance = await tonClient.getBalance(Address.parse(walletRow.address));
        } catch (err: any) {
          app.log.warn(
            { msg: err?.message, walletId: walletRow.id, address: walletRow.address },
            'wallet_balance_fetch_failed_swap'
          );
          return reply.code(503).send({ error: 'ton_balance_unavailable' });
        }
        if (balance < SELL_MIN_TON_FOR_SELL_NANO) {
          return reply.code(400).send({
            error: 'low_ton_balance',
            required_ton: SELL_MIN_TON_FOR_SELL_STR,
            balance_ton: nanoToTonString(balance),
          });
        }
      }
      const order = await insertSwapOrder({
        user_id: payload.user_id,
        wallet_id: payload.wallet_id,
        token_address: payload.token_address,
        direction: payload.direction,
        ton_amount: payload.ton_amount,
        limit_price: payload.limit_price ?? null,
        sell_percent: payload.sell_percent ?? null,
      });
      fanoutCopytradeOrder(order, app.log).catch((err) =>
        app.log.error({ msg: err?.message || err }, 'copytrade_fanout_error')
      );
      if (
        payload.direction === 'buy' &&
        payload.position_hint?.token_amount &&
        payload.position_hint.token_amount > 0
      ) {
        try {
          await upsertUserPosition({
            user_id: payload.user_id,
            wallet_id: payload.wallet_id,
            token_address: payload.token_address,
            token_symbol: payload.position_hint.token_symbol,
            token_name: payload.position_hint.token_name,
            token_image: payload.position_hint.token_image,
            amount: payload.position_hint.token_amount,
            invested_ton: payload.ton_amount,
          });
        } catch (err: any) {
          app.log.error(
            { msg: err?.message, payload },
            'user_position_upsert_failed'
          );
        }
      }
      // Placeholder: future integration will push BOC for relayer processing.
      return reply.send({ order });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /swap error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // GET /user_wallets — simple list of (user_id, address)
  app.get('/user_wallets', async (_req, reply) => {
    try {
      const rows = await listAllUserWallets();
      return reply.send(rows);
    } catch (err: any) {
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /user_wallets error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // POST /wallets { user_id: number }
  app.post('/wallets', async (req, reply) => {
    try {
      const { user_id } = CreateWalletDto.parse((req.body ?? {}) as any);
      const userId = user_id;

      const c = await countWalletsByUser(userId);
      if (c >= 3) return reply.code(400).send({ error: 'limit' });

      // 1) генерим сид
      const wordsArr = await mnemonicNew(24);
      const words = wordsArr.join(' ');

      // 2) адрес
      const address = await deriveTonAddress(wordsArr);

      // 3) шифруем сид
      if (!raw || !MASTER || MASTER.length !== 32) {
        return reply.code(500).send({ error: 'server_misconfiguration' });
      }
      const enc = encryptMnemonic(MASTER, words);

      // 4) сохраняем
      const ins = await insertWallet({ user_id: userId, address, encrypted_mnemonic: enc });
      return reply.code(201).send(ins);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /wallets error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.get('/copytrade/profiles', async (req, reply) => {
    try {
      const { user_id } = QueryUserId.parse((req.query ?? {}) as any);
      const profiles = await listCopytradeProfilesByUser(user_id);
      return reply.send(profiles);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /copytrade/profiles error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.get('/copytrade/sources', async (_req, reply) => {
    try {
      const sources = await listActiveCopytradeSources();
      return reply.send(sources);
    } catch (err: any) {
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /copytrade/sources error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.post('/copytrade/profiles', async (req, reply) => {
    try {
      const { user_id } = CopytradeProfileCreateDto.parse((req.body ?? {}) as any);
      const profile = await createCopytradeProfile(user_id);
      return reply.code(201).send(profile);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /copytrade/profiles error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.patch('/copytrade/profiles/:id', async (req, reply) => {
    const profileId = Number((req.params as any)?.id);
    if (!profileId) {
      return reply.code(400).send({ error: 'id_required' });
    }
    try {
      const payload = CopytradeProfileUpdateDto.parse((req.body ?? {}) as any);
      const normalizedAddress =
        payload.source_address !== undefined
          ? normalizeFriendlyAddress(payload.source_address)
          : undefined;
      if (payload.source_address !== undefined && !normalizedAddress) {
        return reply.code(400).send({ error: 'invalid_source_address' });
      }
      const updated = await updateCopytradeProfile(profileId, payload.user_id, {
        source_address: normalizedAddress,
        name: payload.name,
        smart_mode: payload.smart_mode,
        manual_amount_ton: payload.manual_amount_ton,
        slippage_percent: payload.slippage_percent,
        copy_buy: payload.copy_buy,
        copy_sell: payload.copy_sell,
        platforms: payload.platforms,
        status: payload.status,
      });
      if (!updated) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const profile = await loadCopytradeProfile(payload.user_id, profileId);
      return reply.send(profile || { ...updated, wallets: [] });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      if (err?.message === 'profile_not_found') {
        return reply.code(404).send({ error: 'not_found' });
      }
      app.log.error({ msg: err?.message, stack: err?.stack }, 'PATCH /copytrade/profiles/:id error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.post('/copytrade/profiles/:id/wallets', async (req, reply) => {
    const profileId = Number((req.params as any)?.id);
    if (!profileId) return reply.code(400).send({ error: 'id_required' });
    try {
      const payload = CopytradeWalletsDto.parse((req.body ?? {}) as any);
      const walletIds = payload.wallet_ids ?? [];
      await replaceCopytradeProfileWallets(profileId, payload.user_id, walletIds);
      const profile = await loadCopytradeProfile(payload.user_id, profileId);
      if (!profile) return reply.code(404).send({ error: 'not_found' });
      return reply.send(profile);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      if (err?.message === 'profile_not_found') {
        return reply.code(404).send({ error: 'not_found' });
      }
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /copytrade/profiles/:id/wallets error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.post('/copytrade/signals', async (req, reply) => {
    try {
      const payload = CopytradeSignalDto.parse((req.body ?? {}) as any);
      const normalizedSource = normalizeFriendlyAddress(payload.source_address);
      const normalizedToken = normalizeFriendlyAddress(payload.token_address);
      if (!normalizedSource) {
        return reply.code(400).send({ error: 'invalid_source_address' });
      }
      if (!normalizedToken) {
        return reply.code(400).send({ error: 'invalid_token_address' });
      }
      await fanoutCopytradeSignal(
        {
          sourceAddress: normalizedSource,
          direction: payload.direction,
          tokenAddress: normalizedToken,
          tonAmount: payload.ton_amount,
          limitPriceTon: payload.limit_price,
          sellPercent: payload.sell_percent,
          platform: payload.platform,
        },
        app.log
      );
      return reply.send({ ok: true });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /copytrade/signals error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  app.delete('/wallets/:id', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id_required' });
      const payload = DeleteWalletDto.parse((req.body ?? {}) as any);
      const removed = await deleteWalletById(id, payload.user_id);
      if (!removed) return reply.code(404).send({ error: 'not_found' });
      return reply.send({ ok: true });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'DELETE /wallets/:id error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // GET /wallets/:id
  app.get('/wallets/:id', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const row = await getWalletById(id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return reply.send(row);
    } catch (err: any) {
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /wallets/:id error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // GET /wallets/:id/max_sendable — estimates max TON user can send now (with fees)
  app.get('/wallets/:id/max_sendable', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const row = await getWalletById(id);
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const client = new (TonClient as any)({ endpoint: TON_RPC, apiKey: TON_API_KEY });
      const address = Address.parse(row.address);
      const balance: bigint = await client.getBalance(address);

      // Check deployment state via seqno
      const { publicKey } = await mnemonicToPrivateKey(await mnemonicNew(1).catch(() => [''])); // dummy to satisfy ts
      const dummy = WalletContractV4.create({ workchain: 0, publicKey }); // not used
      const wallet = WalletContractV4.create({ workchain: address.workChain, publicKey: Buffer.alloc(32) } as any);
      // Simpler: try get contract state to infer deployment
      let deployed = true;
      try {
        const state = await (client as any).getContractState(address);
        deployed = Boolean(state?.state === 'active');
      } catch {
        try { await (client as any).open(wallet).getSeqno(); } catch { deployed = false; }
      }

      const reserve: bigint = (toNano as any)(deployed ? '0.01' : '0.02');
      let max = balance > reserve ? (balance - reserve) : 0n;
      if (max < 0n) max = 0n;
      return reply.send({ max_nton: max.toString(), max_ton: nanoToTonString(max) });
    } catch (err: any) {
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /wallets/:id/max_sendable error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // GET /wallets/:id/address — return both formats for deposits
  app.get('/wallets/:id/address', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const row = await getWalletById(id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const variants = addressVariants(row.address);
      return reply.send({ id: row.id, user_id: (row as any).user_id, ...variants });
    } catch (err: any) {
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /wallets/:id/address error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // GET /wallets/:id/balance — баланс TON в нанотонах (string)
  app.get('/wallets/:id/balance', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const row = await getWalletById(id);
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const client = new TonClient({ endpoint: TON_RPC, apiKey: TON_API_KEY } as any);
      const balance = await client.getBalance(Address.parse(row.address));
      return reply.send({ balance: balance.toString(), endpoint: TON_RPC });
    } catch (err: any) {
      console.error('GET /wallets/:id/balance error:', err?.message, err?.stack);
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // POST /transfer { user_id:number, wallet_id:number, to:string, amount_ton:number, comment?:string }
  const TransferDto = z.object({
    user_id: z.coerce.number().int().nonnegative(),
    wallet_id: z.coerce.number().int().positive(),
    to: z.string().min(3),
    amount_ton: z.coerce.number().positive(),
    comment: z.string().max(200).optional(),
  });

  app.post('/transfer', async (req, reply) => {
    try {
      const { user_id, wallet_id, to, amount_ton, comment } = TransferDto.parse((req.body ?? {}) as any);

      const w = await getWalletSecretById(wallet_id);
      if (!w || Number((w as any).user_id) !== user_id) return reply.code(404).send({ error: 'not_found' });

      if (!raw || !MASTER || MASTER.length !== 32) return reply.code(500).send({ error: 'server_misconfiguration' });

      const mnemonic = decryptMnemonic(MASTER, w.encrypted_mnemonic);
      const wordsArr = mnemonic.split(' ');
      const { publicKey, secretKey } = await mnemonicToPrivateKey(wordsArr);
      const wallet = WalletContractV4.create({ workchain: 0, publicKey });

      let toAddr: Address;
      try {
        toAddr = Address.parse(to);
      } catch {
        return reply.code(400).send({ error: 'bad_to' });
      }

      const client = new (TonClient as any)({ endpoint: TON_RPC, apiKey: TON_API_KEY });
      const opened = (client as any).open(wallet);
      const value = (toNano as any)(String(amount_ton));
      const body = comment ? (beginCell as any)().storeUint(0, 32).storeStringTail(comment).endCell() : undefined;

      // Preflight: check balance and whether wallet is deployed
      const balance: bigint = await client.getBalance(wallet.address as any);
      let seqno = 0;
      let deployed = true;
      try {
        seqno = await opened.getSeqno();
      } catch {
        deployed = false;
        seqno = 0;
      }
      const reserve = deployed ? (toNano as any)(0.01) : (toNano as any)(0.02);
      if ((balance as any) < (value as any) + (reserve as any)) {
        return reply.code(400).send({ error: 'insufficient' });
      }

      await opened.sendTransfer({
        seqno,
        secretKey,
        sendMode: (((SendMode as any)?.PAY_GAS_SEPARATELY) ?? 1) | ((((SendMode as any)?.IGNORE_ERRORS) ?? 0)),
        messages: [
          (internal as any)({ to: toAddr, value, bounce: false, body }),
        ],
      });

      return reply.send({ ok: true });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      console.error('POST /transfer error:', err?.message, err?.stack);
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('insufficient') || msg.includes('low balance')) {
        return reply.code(400).send({ error: 'insufficient' });
      }
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // POST /wallets/:id/seed — выдать сид после подтверждения
  const SeedDto = z.object({ user_id: z.coerce.number().int().nonnegative(), confirm: z.boolean() });
  app.post('/wallets/:id/seed', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const { user_id, confirm } = SeedDto.parse((req.body ?? {}) as any);
      if (!confirm) return reply.code(400).send({ error: 'confirm_required' });
      const w = await getWalletSecretById(id);
      if (!w || Number((w as any).user_id) !== user_id) return reply.code(404).send({ error: 'not_found' });
      if (!raw || !MASTER || MASTER.length !== 32) return reply.code(500).send({ error: 'server_misconfiguration' });
      const mnemonic = decryptMnemonic(MASTER, w.encrypted_mnemonic);
      return reply.send({ mnemonic });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      return reply.code(500).send({ error: 'internal' });
    }
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n✅ wallet-api listening on http://localhost:${PORT}`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
