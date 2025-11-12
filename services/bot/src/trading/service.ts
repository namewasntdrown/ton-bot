import axios from 'axios';
import { Buffer } from 'buffer';
import { Markup } from 'telegraf';
import { Address, Cell } from '@ton/core';

export type ExternalLink = { title: string; url: string };
const WALLET_API = process.env.WALLET_API || 'http://127.0.0.1:8090';

export type TokenSnapshot = {
  address: string;
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  priceUsd?: number;
  priceTon?: number;
  tonPriceUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  txns24h?: number;
  txns1h?: number;
  priceChange1hPct?: number;
  priceChange6hPct?: number;
  priceChange24hPct?: number;
  holders?: number | null;
  links: ExternalLink[];
  chartImage?: Buffer;
  source?: 'ston' | 'dedust';
  updatedAt: number;
  totalSupplyTokens?: number;
  mintable?: boolean;
  adminAddress?: string | null;
  lpLocked?: boolean | null;
  ownershipRenounced?: boolean | null;
};

export type TokenSearchItem = {
  address: string;
  name: string;
  symbol?: string;
  image?: string;
  fdvUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  priceChange24hPct?: number;
};

type DedustAsset = {
  type: 'jetton' | 'native';
  address?: string;
  name?: string;
  symbol?: string;
  image?: string;
  decimals?: number;
  source?: {
    chain?: string;
    address?: string;
    bridge?: string;
    symbol?: string;
    name?: string;
  };
};

type DedustTicker = {
  ticker_id: string;
  base_currency: string;
  target_currency: string;
  last_price?: string;
  base_volume?: string;
  target_volume?: string;
  liquidity_in_usd?: string;
  pool_id: string;
};

type DedustTrade = {
  sender?: string;
  assetIn?: { type?: string; address?: string };
  assetOut?: { type?: string; address?: string };
  amountIn?: string;
  amountOut?: string;
  createdAt?: string;
};

type DedustMetadata = {
  name?: string;
  symbol?: string;
  decimals?: number;
  image?: string;
  description?: string;
  websites?: Array<{ url?: string } | string>;
  socials?: Array<{ url?: string } | string>;
  github?: string;
  twitter?: string;
  telegram?: string;
};

type DedustAssetCache = {
  items: DedustAsset[];
  map: Map<string, DedustAsset>;
  fetchedAt: number;
};

type DedustTickerCache = {
  list: DedustTicker[];
  fetchedAt: number;
};

type DedustCoinResponse = {
  items: DedustCoin[];
  total_count: number;
};

type DedustCoin = {
  asset: string;
  liquidity?: string;
  market_cap?: string;
  fully_diluted_market_cap?: string;
  holders?: number;
  metadata: {
    name?: string;
    ticker?: string;
    image_url?: string;
    decimals?: number;
    description?: string;
    usd_price?: string;
    social_links?: Array<{ url?: string } | string> | string;
  };
  price?: {
    usd_value?: string;
    usd_change?: {
      h1?: number;
      h6?: number;
      h24?: number;
      d7?: number;
    };
    ton_value?: string;
  };
  volume?: {
    periods?: {
      h1?: string;
      h6?: string;
      h24?: string;
      d7?: string;
    };
  };
  transactions?: {
    total?: {
      h1?: number;
      h6?: number;
      h24?: number;
      d7?: number;
    };
  };
};

type CachedMetadata = { data: DedustMetadata; fetchedAt: number };
type JettonOnchainData = {
  totalSupply?: bigint;
  mintable?: boolean;
  adminAddress?: string | null;
};
export type TradingProfile = {
  user_id: number;
  active_wallet_id?: number | null;
  ton_amount?: number | null;
  buy_limit_price?: number | null;
  sell_percent?: number | null;
  trade_mode?: 'buy' | 'sell' | null;
  last_token?: string | null;
};
export type WalletSummary = {
  id: number;
  address: string;
  balance_nton?: string | null;
  balance?: string | null;
  balanceNton?: string | null;
};
export type WalletJettonBalance = {
  wallet_id: number;
  wallet_address: string;
  token_address: string;
  jetton_wallet_address?: string;
  balance_raw: string;
  balance: string;
  decimals: number;
};
export type UserPositionSummary = {
  id: number;
  user_id: number;
  wallet_id: number;
  wallet_address: string;
  token_address: string;
  token_symbol?: string | null;
  token_name?: string | null;
  token_image?: string | null;
  amount: string;
  invested_ton: string;
  is_hidden?: boolean;
  created_at: string;
  updated_at: string;
};
export type TradingContext = {
  profile: TradingProfile | null;
  wallets: WalletSummary[];
};

const COINGECKO_PRICE_URL =
  process.env.COINGECKO_PRICE_URL ||
  'https://api.coingecko.com/api/v3/simple/price';
const DEDUST_API_BASE_URL =
  process.env.DEDUST_API_BASE_URL || 'https://api.dedust.io';
const DEDUST_TON_ADDRESS =
  process.env.DEDUST_TON_ADDRESS ||
  'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const DEDUST_COINS_API_BASE_URL =
  process.env.DEDUST_COINS_API_BASE_URL || 'https://dedust.io/v1/api';
const DEDUST_COINS_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'ton-bot/coins-fetcher',
};
const TON_ADDRESS_RE = /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/;
const TON_ADDRESS_SEARCH_RE = /(?:EQ|UQ)[A-Za-z0-9_-]{46}/;
const MAX_INLINE_RESULTS = 120;
const POPULAR_TOKEN_CACHE_TTL = 30_000;
const DEDUST_ASSET_CACHE_TTL = 5 * 60_000;
const DEDUST_TICKER_CACHE_TTL = 30_000;
const DEDUST_METADATA_CACHE_TTL = 10 * 60_000;
const TON_RPC_ENDPOINT =
  process.env.TON_RPC_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
const TON_RPC_API_KEY = process.env.TON_RPC_API_KEY || '';

export const tokenSnapshotCache = new Map<string, TokenSnapshot>();
const tonPriceCache = { value: 0, fetchedAt: 0 };
const popularTokenCache = { tokens: [] as TokenSearchItem[], fetchedAt: 0 };
const dedustAssetCache: DedustAssetCache = {
  items: [],
  map: new Map(),
  fetchedAt: 0,
};
const dedustTickerCache: DedustTickerCache = { list: [], fetchedAt: 0 };
const dedustMetadataCache = new Map<string, CachedMetadata>();
const walletJettonBalanceCache = new Map<
  string,
  { value: WalletJettonBalance; fetchedAt: number }
>();
const WALLET_JETTON_CACHE_TTL = 15_000;
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});
const NANO_IN_TON = 1_000_000_000n;

export function normalizeJettonAddress(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/\s+/g, '');
  if (TON_ADDRESS_RE.test(clean)) return clean;
  const match = raw.match(TON_ADDRESS_SEARCH_RE);
  if (match) return match[0];
  return null;
}

function parseFriendlyAddress(address: string): Address | null {
  try {
    return Address.parse(address);
  } catch {
    return null;
  }
}

function getRawAddress(address: string): string | null {
  const parsed = parseFriendlyAddress(address);
  if (!parsed) return null;
  try {
    return parsed.toRawString();
  } catch {
    return null;
  }
}

function toJettonAssetKey(address: string): string | null {
  if (!address) return null;
  if (address === DEDUST_TON_ADDRESS) return 'native';
  const raw = getRawAddress(address);
  if (!raw) return null;
  return `jetton:${raw}`;
}

function numberFrom(...values: any[]): number | undefined {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function bigintFromStackValue(value: any): bigint | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

async function fetchJettonOnchainData(
  address: string
): Promise<JettonOnchainData | null> {
  if (!TON_RPC_ENDPOINT) return null;
  const normalized = normalizeJettonAddress(address);
  if (!normalized) return null;
  const raw = getRawAddress(normalized);
  if (!raw) return null;

  try {
    const headers = TON_RPC_API_KEY
      ? { 'X-API-Key': TON_RPC_API_KEY }
      : undefined;
    const { data } = await axios.post(
      TON_RPC_ENDPOINT,
      {
        jsonrpc: '2.0',
        id: `jetton:${raw}`,
        method: 'runGetMethod',
        params: {
          address: raw,
          method: 'get_jetton_data',
          stack: [],
        },
      },
      { headers, timeout: 10_000 }
    );
    if (!data?.ok || data?.result?.exit_code !== 0) {
      return null;
    }
    const stack = data.result?.stack;
    const totalSupply = bigintFromStackValue(stack?.[0]?.[1]);
    const mintableValue = bigintFromStackValue(stack?.[1]?.[1]);

    let adminAddress: string | null = null;
    const adminCellBoc =
      stack?.[2]?.[1]?.bytes ||
      stack?.[2]?.[1]?.cell ||
      stack?.[2]?.[1];
    if (typeof adminCellBoc === 'string' && adminCellBoc) {
      try {
        const cells = Cell.fromBoc(Buffer.from(adminCellBoc, 'base64'));
        if (cells.length) {
          const slice = cells[0].beginParse();
          const addr = slice.loadMaybeAddress();
          adminAddress = addr
            ? addr.toString({ bounceable: true, urlSafe: true })
            : null;
        }
      } catch {}
    }

    return {
      totalSupply,
      mintable:
        mintableValue === undefined ? undefined : mintableValue !== 0n,
      adminAddress,
    };
  } catch (err: any) {
    console.warn('jetton onchain data fetch failed:', err?.message);
    return null;
  }
}

export function formatUsd(value?: number): string {
  if (value === undefined) return 'н/д';
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  return `$${compactNumberFormatter.format(value)}`;
}

function formatTonValue(value?: number): string {
  if (value === undefined) return 'н/д';
  if (Math.abs(value) >= 1) {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  }
  return value.toFixed(6);
}

function formatUsdPrice(value?: number): string {
  if (value === undefined) return 'н/д';
  if (Math.abs(value) >= 1) {
    return `$${value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}`;
  }
  if (Math.abs(value) >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(6)}`;
}

export function formatPercent(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return 'н/д';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatBooleanText(value: boolean | null | undefined): string {
  if (value === true) return 'Да';
  if (value === false) return 'Нет';
  return 'н/д';
}

function formatCount(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return 'н/д';
  return Number(value).toLocaleString('ru-RU');
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(num) ? num : null;
}
function normalizeProfile(raw: any): TradingProfile | null {
  if (!raw) return null;
  return {
    user_id: Number(raw.user_id),
    active_wallet_id:
      raw.active_wallet_id === undefined ? null : raw.active_wallet_id,
    ton_amount: toNumber(raw.ton_amount),
    buy_limit_price: toNumber(raw.buy_limit_price),
    sell_percent: toNumber(raw.sell_percent),
    trade_mode: raw.trade_mode === 'sell' ? 'sell' : 'buy',
    last_token: raw.last_token ?? null,
  };
}

function normalizeWallets(list: any[]): WalletSummary[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    id: Number(item.id),
    address: String(item.address || ''),
    balance_nton: item.balance_nton ?? item.balance ?? item.balanceNton ?? null,
    balance: item.balance,
    balanceNton: item.balanceNton,
  }));
}

export async function fetchTradingProfileContext(
  userId: number
): Promise<{ profile: TradingProfile | null; wallets: WalletSummary[] }> {
  const { data } = await axios.get(`${WALLET_API}/trading/profile`, {
    params: { user_id: userId },
    timeout: 10_000,
  });
  const profile = normalizeProfile(data?.profile);
  const wallets = normalizeWallets(data?.wallets);
  return { profile, wallets };
}

export async function fetchWalletJettonBalance(
  walletId: number,
  tokenAddress: string
): Promise<WalletJettonBalance> {
  const encoded = encodeURIComponent(tokenAddress);
  const cacheKey = `${walletId}:${tokenAddress}`;
  const cached = walletJettonBalanceCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < WALLET_JETTON_CACHE_TTL) {
    return cached.value;
  }
  const { data } = await axios.get(
    `${WALLET_API}/wallets/${walletId}/jettons/${encoded}/balance`,
    { timeout: 15_000 }
  );
  const value = data as WalletJettonBalance;
  walletJettonBalanceCache.set(cacheKey, { value, fetchedAt: Date.now() });
  return value;
}

export async function fetchUserPositions(
  userId: number,
  options: { includeHidden?: boolean } = {}
): Promise<UserPositionSummary[]> {
  const { includeHidden = false } = options;
  const { data } = await axios.get(`${WALLET_API}/positions`, {
    params: { user_id: userId, include_hidden: includeHidden ? 1 : 0 },
    timeout: 10_000,
  });
  return Array.isArray(data) ? data : [];
}

export async function setUserPositionHidden(
  userId: number,
  positionId: number,
  hidden: boolean
): Promise<UserPositionSummary> {
  const { data } = await axios.post(
    `${WALLET_API}/positions/${positionId}/hide`,
    { user_id: userId, hidden },
    { timeout: 10_000 }
  );
  return data as UserPositionSummary;
}

export async function updateTradingProfile(
  userId: number,
  patch: Partial<TradingProfile>
): Promise<TradingProfile> {
  const payload: any = { user_id: userId };
  if ('active_wallet_id' in patch) payload.active_wallet_id = patch.active_wallet_id;
  if ('ton_amount' in patch) payload.ton_amount = patch.ton_amount;
  if ('buy_limit_price' in patch) payload.buy_limit_price = patch.buy_limit_price;
  if ('sell_percent' in patch) payload.sell_percent = patch.sell_percent;
  if ('trade_mode' in patch && patch.trade_mode)
    payload.trade_mode = patch.trade_mode;
  if ('last_token' in patch) payload.last_token = patch.last_token;

  const { data } = await axios.post(`${WALLET_API}/trading/profile`, payload, {
    timeout: 10_000,
  });
  const profile = normalizeProfile(data);
  if (!profile) {
    throw new Error('Failed to update trading profile');
  }
  return profile;
}

export type SwapOrderRequest = {
  user_id: number;
  wallet_id: number;
  token_address: string;
  direction: 'buy' | 'sell';
  ton_amount: number;
  limit_price?: number | null;
  sell_percent?: number | null;
  position_hint?: {
    token_amount?: number;
    token_price_ton?: number;
    token_price_usd?: number;
    token_symbol?: string;
    token_name?: string;
    token_image?: string;
  } | null;
};

export async function submitSwapOrder(
  payload: SwapOrderRequest
): Promise<{ order: any }> {
  const response = await axios.post(`${WALLET_API}/swap`, payload, {
    timeout: 25_000,
    validateStatus: () => true,
  });
  if (response.status >= 400) {
    const code = response.data?.error || 'swap_failed';
    const error = new Error(code);
    (error as any).code = code;
    throw error;
  }
  return response.data;
}
const QUICK_TON_AMOUNTS = [10, 25, 50, 100];
const QUICK_PERCENT_VALUES = [10, 25, 50, 100];

export function shortAddress(addr?: string): string {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function toNanoBigInt(value: unknown): bigint {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
      return BigInt(value.trim());
    }
  } catch {
    // ignore
  }
  return 0n;
}

function formatTonFromNanoValue(value: bigint): string {
  let nano = value;
  const negative = nano < 0n;
  if (negative) nano = -nano;
  const intPart = nano / NANO_IN_TON;
  const fracRaw = (nano % NANO_IN_TON).toString().padStart(9, '0');
  const frac = fracRaw.replace(/0+$/, '');
  const text = frac ? `${intPart}.${frac}` : `${intPart}`;
  return negative ? `-${text}` : text;
}

export function walletBalanceTon(wallet?: WalletSummary): string {
  if (!wallet) return '0';
  const nano = toNanoBigInt(wallet.balance_nton ?? wallet.balance ?? wallet.balanceNton ?? 0);
  return formatTonFromNanoValue(nano);
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size);
    if (chunk.length) result.push(chunk);
  }
  return result;
}

function formatTonWithApproxUsd(value: number, tonPriceUsd: number): string {
  const usd = tonPriceUsd ? ` · ~$${(value * tonPriceUsd).toFixed(2)}` : '';
  return `${value} TON${usd}`;
}

function formatInputNumber(value?: number | null): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (Math.abs(value) >= 1) {
    return Number(value.toFixed(2)).toString();
  }
  return Number(value.toFixed(4)).toString();
}

function formatCustomPrimaryLabel(
  mode: 'buy' | 'sell',
  tonAmount: number | null | undefined,
  sellPercent: number | null | undefined
): string {
  if (mode === 'buy') {
    const formatted = formatInputNumber(tonAmount);
    if (formatted) {
      return `✏️ Своя сумма (${formatted} TON)`;
    }
    return '✏️ Своя сумма';
  }
  const formatted = formatInputNumber(sellPercent);
  if (formatted) {
    return `✏️ Свой % (${formatted}%)`;
  }
  return '✏️ Свой %';
}

function formatLimitPriceLabel(price?: number | null): string {
  const formatted = formatInputNumber(price);
  if (!formatted) {
    return '🎯 Лимит цены';
  }
  return `🎯 Лимит ${formatted} TON`;
}
async function loadTradingContext(userId?: number): Promise<TradingContext | null> {
  if (!userId) return null;
  try {
    return await fetchTradingProfileContext(userId);
  } catch (err: any) {
    console.warn('trading profile fetch failed:', err?.message);
    return null;
  }
}
function dedustAssetAddress(asset?: DedustAsset | null): string | null {
  if (!asset) return null;
  if (asset.type === 'native') return DEDUST_TON_ADDRESS;
  return asset.address ?? null;
}

async function loadDedustAssets(
  force = false
): Promise<DedustAssetCache> {
  if (
    !force &&
    dedustAssetCache.items.length &&
    Date.now() - dedustAssetCache.fetchedAt < DEDUST_ASSET_CACHE_TTL
  ) {
    return dedustAssetCache;
  }
  try {
    const { data } = await axios.get<DedustAsset[]>(
      `${DEDUST_API_BASE_URL}/v2/assets`,
      { timeout: 15_000 }
    );
    const items = Array.isArray(data) ? data : [];
    const map = new Map<string, DedustAsset>();
    for (const asset of items) {
      const addr = dedustAssetAddress(asset);
      if (addr) map.set(addr, asset);
    }
    dedustAssetCache.items = items;
    dedustAssetCache.map = map;
    dedustAssetCache.fetchedAt = Date.now();
  } catch (err: any) {
    console.warn('dedust assets fetch failed:', err?.message);
  }
  return dedustAssetCache;
}

async function fetchDedustTickers(
  force = false
): Promise<DedustTicker[]> {
  if (
    !force &&
    dedustTickerCache.list.length &&
    Date.now() - dedustTickerCache.fetchedAt < DEDUST_TICKER_CACHE_TTL
  ) {
    return dedustTickerCache.list;
  }
  try {
    const { data } = await axios.get<DedustTicker[]>(
      `${DEDUST_API_BASE_URL}/v2/gcko/tickers`,
      { timeout: 15_000 }
    );
    dedustTickerCache.list = Array.isArray(data) ? data : [];
    dedustTickerCache.fetchedAt = Date.now();
  } catch (err: any) {
    console.warn('dedust tickers fetch failed:', err?.message);
  }
  return dedustTickerCache.list;
}

async function fetchDedustMetadata(
  address: string,
  force = false
): Promise<DedustMetadata | null> {
  if (address === DEDUST_TON_ADDRESS) {
    return { name: 'Toncoin', symbol: 'TON', decimals: 9 };
  }
  const cached = dedustMetadataCache.get(address);
  if (
    !force &&
    cached &&
    Date.now() - cached.fetchedAt < DEDUST_METADATA_CACHE_TTL
  ) {
    return cached.data;
  }
  try {
    const { data } = await axios.get<DedustMetadata>(
      `${DEDUST_API_BASE_URL}/v2/jettons/${address}/metadata`,
      { timeout: 10_000 }
    );
    if (data) {
      dedustMetadataCache.set(address, { data, fetchedAt: Date.now() });
      return data;
    }
  } catch (err: any) {
    console.warn('dedust metadata fetch failed:', err?.message);
  }
  return null;
}

async function fetchDedustTrades(poolId: string): Promise<DedustTrade[]> {
  if (!poolId) return [];
  try {
    const { data } = await axios.get<DedustTrade[]>(
      `${DEDUST_API_BASE_URL}/v2/pools/${poolId}/trades`,
      { timeout: 10_000 }
    );
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    console.warn('dedust trades fetch failed:', err?.message);
    return [];
  }
}

function selectDedustTicker(
  address: string,
  tickers: DedustTicker[]
): DedustTicker | null {
  if (!address || !tickers.length) return null;
  const filtered = tickers.filter(
    (ticker) =>
      (ticker.base_currency === address ||
        ticker.target_currency === address) &&
      (ticker.base_currency === DEDUST_TON_ADDRESS ||
        ticker.target_currency === DEDUST_TON_ADDRESS)
  );
  if (!filtered.length) return null;
  return filtered
    .slice()
    .sort(
      (a, b) =>
        (numberFrom(b.liquidity_in_usd) || 0) -
        (numberFrom(a.liquidity_in_usd) || 0)
    )[0];
}

function computePriceTonFromTicker(
  ticker: DedustTicker,
  address: string
): number | undefined {
  const lastPrice = numberFrom(ticker.last_price);
  if (!lastPrice || lastPrice <= 0) return undefined;
  if (
    ticker.base_currency === address &&
    ticker.target_currency === DEDUST_TON_ADDRESS
  ) {
    return lastPrice;
  }
  if (
    ticker.target_currency === address &&
    ticker.base_currency === DEDUST_TON_ADDRESS
  ) {
    return 1 / lastPrice;
  }
  return undefined;
}

function tonVolumeFromTicker(ticker: DedustTicker): number | undefined {
  if (ticker.base_currency === DEDUST_TON_ADDRESS) {
    return numberFrom(ticker.base_volume);
  }
  if (ticker.target_currency === DEDUST_TON_ADDRESS) {
    return numberFrom(ticker.target_volume);
  }
  return undefined;
}

function computeVolumeUsdFromTicker(
  ticker: DedustTicker,
  tonPriceUsd?: number,
  priceTon?: number
): number | undefined {
  const tonVolume = tonVolumeFromTicker(ticker);
  if (tonVolume !== undefined && tonPriceUsd !== undefined) {
    return tonVolume * tonPriceUsd;
  }
  if (
    priceTon !== undefined &&
    tonPriceUsd !== undefined
  ) {
    const tokenVolume =
      ticker.base_currency === DEDUST_TON_ADDRESS
        ? numberFrom(ticker.target_volume)
        : numberFrom(ticker.base_volume);
    if (tokenVolume !== undefined) {
      return tokenVolume * priceTon * tonPriceUsd;
    }
  }
  return undefined;
}

function dedustAssetMatchesQuery(
  asset: DedustAsset,
  query: string
): boolean {
  const lowered = query.toLowerCase();
  if (asset.name?.toLowerCase().includes(lowered)) return true;
  if (asset.symbol?.toLowerCase().includes(lowered)) return true;
  if (asset.address?.toLowerCase() === lowered) return true;
  if (asset.source?.symbol?.toLowerCase() === lowered) return true;
  return false;
}

function buildTokenSearchItemFromTicker(
  address: string,
  asset: DedustAsset | undefined,
  ticker: DedustTicker,
  tonPriceUsd?: number
): TokenSearchItem | null {
  const priceTon = computePriceTonFromTicker(ticker, address);
  const priceUsd = priceTon && tonPriceUsd ? priceTon * tonPriceUsd : undefined;
  return {
    address,
    name: asset?.name || asset?.symbol || address.slice(0, 6),
    symbol: asset?.symbol,
    image: asset?.image,
    fdvUsd: undefined,
    liquidityUsd: numberFrom(ticker.liquidity_in_usd),
    volume24hUsd: computeVolumeUsdFromTicker(ticker, tonPriceUsd, priceTon),
    priceChange24hPct: undefined,
  };
}

function countTradesWithinHours(
  trades: DedustTrade[],
  hours: number
): number {
  if (!trades.length) return 0;
  const threshold = Date.now() - hours * 60 * 60 * 1000;
  return trades.filter((trade) => {
    if (!trade.createdAt) return false;
    const created = Date.parse(trade.createdAt);
    if (Number.isNaN(created)) return false;
    return created >= threshold;
  }).length;
}

function dedupeTokens(
  tokens: TokenSearchItem[],
  limit: number = MAX_INLINE_RESULTS
): TokenSearchItem[] {
  const map = new Map<string, TokenSearchItem>();
  for (const token of tokens) {
    const key = token.address.toLowerCase();
    if (!map.has(key)) {
      map.set(key, token);
      if (map.size >= limit) break;
    }
  }
  return Array.from(map.values());
}

function dedustCoinAssetToAddress(asset: string): string | null {
  if (!asset) return null;
  if (asset === 'native') return DEDUST_TON_ADDRESS;
  const parts = asset.split(':');
  if (parts.length < 3) return null;
  const workchain = parts[1];
  const hash = parts.slice(2).join(':');
  const raw = `${workchain}:${hash}`;
  try {
    const parsed = Address.parseRaw(raw);
    return parsed.toString({ bounceable: true, urlSafe: true });
  } catch {
    return null;
  }
}

function buildTokenSearchItemFromCoin(coin: DedustCoin): TokenSearchItem | null {
  const address = dedustCoinAssetToAddress(coin.asset);
  if (!address) return null;
  const metadata = coin.metadata || {};
  const liquidityUsd = numberFrom(coin.liquidity);
  const fdvUsd = numberFrom(
    coin.fully_diluted_market_cap ?? coin.market_cap ?? undefined
  );
  const volume24hUsd = numberFrom(coin.volume?.periods?.h24 ?? undefined);
  const priceChange24hPct = numberFrom(coin.price?.usd_change?.h24 ?? undefined);
  return {
    address,
    name: metadata.name || metadata.ticker || address.slice(0, 6),
    symbol: metadata.ticker,
    image: metadata.image_url,
    fdvUsd,
    liquidityUsd,
    volume24hUsd,
    priceChange24hPct,
  };
}

async function fetchDedustCoinsTop(
  limit: number
): Promise<TokenSearchItem[] | null> {
  try {
    const perPage = Math.min(Math.max(limit, 1), 200);
    const { data } = await axios.get<DedustCoinResponse>(
      `${DEDUST_COINS_API_BASE_URL}/coins`,
      {
        params: {
          page: 1,
          perPage,
          sort_by: 'market_cap',
          sort_direction: 'desc',
          sort_period: '24h',
          compact: false,
        },
        timeout: 15_000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ton-bot/coins-fetcher',
        },
      }
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    const tokens = items
      .map((coin) => buildTokenSearchItemFromCoin(coin))
      .filter((token): token is TokenSearchItem => Boolean(token));
    if (tokens.length) return tokens.slice(0, limit);
  } catch (err: any) {
    console.warn('dedust coins fetch failed:', err?.message || err);
  }
  return null;
}

async function fetchDedustCoinDetails(address: string): Promise<DedustCoin | null> {
  const assetKey = toJettonAssetKey(address);
  if (!assetKey) return null;
  try {
    const { data } = await axios.get<DedustCoinResponse>(
      `${DEDUST_COINS_API_BASE_URL}/coins`,
      {
        params: {
          page: 1,
          perPage: 1,
          filter_by_assets: assetKey,
          compact: false,
        },
        timeout: 15_000,
        headers: DEDUST_COINS_HEADERS,
      }
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    return items[0] || null;
  } catch (err: any) {
    console.warn('dedust coin detail fetch failed:', err?.message || err);
    return null;
  }
}

async function buildPopularTokensFromTickers(): Promise<TokenSearchItem[]> {
  const [{ map }, tickers, tonPriceUsd] = await Promise.all([
    loadDedustAssets(),
    fetchDedustTickers(),
    getTonPriceUsd(),
  ]);

  const sorted = tickers
    .filter(
      (ticker) =>
        ticker.base_currency === DEDUST_TON_ADDRESS ||
        ticker.target_currency === DEDUST_TON_ADDRESS
    )
    .slice()
    .sort(
      (a, b) =>
        (numberFrom(b.liquidity_in_usd) || 0) -
        (numberFrom(a.liquidity_in_usd) || 0)
    );

  const seen = new Set<string>();
  const tokens: TokenSearchItem[] = [];
  for (const ticker of sorted) {
    const tokenAddress =
      ticker.base_currency === DEDUST_TON_ADDRESS
        ? ticker.target_currency
        : ticker.base_currency;
    if (!tokenAddress || seen.has(tokenAddress)) continue;
    const asset = map.get(tokenAddress);
    const token = buildTokenSearchItemFromTicker(
      tokenAddress,
      asset,
      ticker,
      tonPriceUsd
    );
    if (!token) continue;
    tokens.push(token);
    seen.add(tokenAddress);
    if (tokens.length >= MAX_INLINE_RESULTS) break;
  }
  return tokens;
}

async function getPopularTokenSearchResults(): Promise<TokenSearchItem[]> {
  if (
    popularTokenCache.tokens.length &&
    Date.now() - popularTokenCache.fetchedAt < POPULAR_TOKEN_CACHE_TTL
  ) {
    return popularTokenCache.tokens;
  }
  const coinsTokens = await fetchDedustCoinsTop(MAX_INLINE_RESULTS);
  if (coinsTokens?.length) {
    popularTokenCache.tokens = coinsTokens;
    popularTokenCache.fetchedAt = Date.now();
    return coinsTokens;
  }

  const fallbackTokens = await buildPopularTokensFromTickers();
  if (fallbackTokens.length) {
    popularTokenCache.tokens = fallbackTokens;
    popularTokenCache.fetchedAt = Date.now();
    return fallbackTokens;
  }

  return popularTokenCache.tokens;
}

function escapeHtml(str?: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'менее минуты назад';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  return `${Math.floor(diff / 3_600_000)} ч назад`;
}

export async function getTonPriceUsd(force = false): Promise<number | undefined> {
  if (
    !force &&
    tonPriceCache.value &&
    Date.now() - tonPriceCache.fetchedAt < 5 * 60_000
  ) {
    return tonPriceCache.value;
  }
  try {
    const { data } = await axios.get(COINGECKO_PRICE_URL, {
      params: { ids: 'the-open-network', vs_currencies: 'usd' },
      timeout: 7_000,
    });
    const price = numberFrom(data?.['the-open-network']?.usd);
    if (price && price > 0) {
      tonPriceCache.value = price;
      tonPriceCache.fetchedAt = Date.now();
      return price;
    }
  } catch (err: any) {
    console.warn('TON price fetch failed:', err?.message);
  }
  return tonPriceCache.value || undefined;
}

function buildExternalLinks(
  address: string,
  meta: any,
  info: any
): ExternalLink[] {
  const normalizeLink = (value: any): string | undefined => {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (typeof value.url === 'string') return value.url;
      if (typeof value.href === 'string') return value.href;
    }
    return undefined;
  };

  const links = new Map<string, ExternalLink>();
  const add = (title: string, url?: string) => {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return;
    if (!links.has(title)) links.set(title, { title, url });
  };

  add('DeDust.io', `https://dedust.io/swap/TON/${address}`);
  add('Tonviewer', `https://tonviewer.com/${address}`);

  const websites =
    meta?.websites ||
    meta?.website ||
    info?.websites ||
    info?.websiteUrls ||
    [];
  const socials = meta?.socials || info?.socials || info?.socialsUrls || [];
  add('Website', Array.isArray(websites) ? websites[0] : websites);
  (Array.isArray(websites) ? websites.slice(1) : []).forEach((url: string, idx: number) =>
    add(`Website ${idx + 2}`, normalizeLink(url))
  );
  (Array.isArray(socials) ? socials : []).forEach((url: string) => {
    const normalized = normalizeLink(url);
    if (!normalized) return;
    const lower = normalized.toLowerCase();
    if (lower.includes('twitter.com')) add('Twitter', normalized);
    else if (lower.includes('telegram')) add('Telegram', normalized);
  });
  add('GitHub', normalizeLink(meta?.github));
  add(
    'Twitter',
    meta?.twitter
      ? meta.twitter.startsWith('http')
        ? meta.twitter
        : `https://twitter.com/${meta.twitter.replace('@', '')}`
      : meta?.twitter_handle
      ? `https://twitter.com/${meta.twitter_handle.replace('@', '')}`
      : undefined
  );
  add('Telegram', normalizeLink(meta?.telegram));
  add('CoinMarketCap', normalizeLink(meta?.cmc));
  add('CoinGecko', normalizeLink(meta?.coingecko));

  return Array.from(links.values()).slice(0, 6);
}

async function fetchDedustTokenSnapshot(
  address: string
): Promise<TokenSnapshot | null> {
  const [{ map }, tickers, tonPriceUsd, metadata, jettonData, coinData] =
    await Promise.all([
      loadDedustAssets(),
      fetchDedustTickers(),
      getTonPriceUsd(),
      fetchDedustMetadata(address).catch(() => null),
      fetchJettonOnchainData(address).catch(() => null),
      fetchDedustCoinDetails(address).catch(() => null),
    ]);

  const asset = map.get(address);
  const ticker = selectDedustTicker(address, tickers);
  if (!ticker) return null;

  const priceTonCoin = numberFrom(coinData?.price?.ton_value);
  const priceTonTicker = computePriceTonFromTicker(ticker, address);
  const priceTon = priceTonCoin ?? priceTonTicker;
  const priceUsdCoin = numberFrom(
    coinData?.metadata?.usd_price,
    coinData?.price?.usd_value
  );
  const priceUsd =
    priceUsdCoin ??
    (priceTon !== undefined && tonPriceUsd ? priceTon * tonPriceUsd : undefined);
  const decimals =
    Number(metadata?.decimals ?? asset?.decimals ?? coinData?.metadata?.decimals ?? 9) ||
    9;
  const supplyTokens =
    jettonData?.totalSupply !== undefined
      ? Number(jettonData.totalSupply) / Math.pow(10, decimals)
      : undefined;
  const fdvUsd = numberFrom(
    coinData?.fully_diluted_market_cap,
    coinData?.market_cap,
    supplyTokens !== undefined && priceUsd !== undefined
      ? supplyTokens * priceUsd
      : undefined
  );
  const ownershipRenounced =
    jettonData?.adminAddress === null
      ? true
      : jettonData?.adminAddress
      ? false
      : null;
  const trades = await fetchDedustTrades(ticker.pool_id);
  const links = buildExternalLinks(address, metadata, coinData?.metadata);
  const txns24h = numberFrom(
    coinData?.transactions?.total?.h24,
    countTradesWithinHours(trades, 24)
  );
  const txns1h = numberFrom(
    coinData?.transactions?.total?.h1,
    countTradesWithinHours(trades, 1)
  );

  return {
    address,
    name:
      metadata?.name ||
      asset?.name ||
      coinData?.metadata?.name ||
      metadata?.symbol ||
      asset?.symbol ||
      coinData?.metadata?.ticker ||
      'Token',
    symbol: metadata?.symbol || asset?.symbol || coinData?.metadata?.ticker,
    description: metadata?.description || coinData?.metadata?.description || '',
    image: metadata?.image || coinData?.metadata?.image_url || asset?.image,
    priceUsd,
    priceTon,
    tonPriceUsd,
    fdvUsd,
    liquidityUsd: numberFrom(coinData?.liquidity, ticker.liquidity_in_usd),
    volume24hUsd: numberFrom(
      coinData?.volume?.periods?.h24,
      computeVolumeUsdFromTicker(ticker, tonPriceUsd, priceTonTicker)
    ),
    txns24h,
    txns1h,
    priceChange1hPct: undefined,
    priceChange6hPct: undefined,
    priceChange24hPct: numberFrom(coinData?.price?.usd_change?.h24),
    holders: coinData?.holders ?? null,
    links,
    chartImage: undefined,
    source: 'dedust',
    updatedAt: Date.now(),
    totalSupplyTokens: supplyTokens,
    mintable: jettonData?.mintable,
    adminAddress: jettonData?.adminAddress ?? null,
    lpLocked: null,
    ownershipRenounced,
  };
}

export async function fetchTokenSnapshot(
  address: string,
  force = false
): Promise<TokenSnapshot> {
  if (!force) {
    const cached = tokenSnapshotCache.get(address);
    if (cached && Date.now() - cached.updatedAt < 60_000) {
      return cached;
    }
  }

  const snapshot = await fetchDedustTokenSnapshot(address);
  if (!snapshot) {
    throw new Error('Failed to fetch token data from DeDust.io');
  }
  tokenSnapshotCache.set(address, snapshot);
  return snapshot;
}

export function buildTokenSummary(snapshot: TokenSnapshot): string {
  const lines: string[] = [];
  const tokenLabel =
    snapshot.symbol && snapshot.name && snapshot.symbol !== snapshot.name
      ? `${snapshot.symbol} (${snapshot.name})`
      : snapshot.symbol || snapshot.name || 'Токен';
  lines.push(`⭐ <b>${escapeHtml(tokenLabel)}</b>`);

  lines.push(
    `💰 <b>Цена:</b> ${formatTonValue(snapshot.priceTon)} TON (${formatUsdPrice(
      snapshot.priceUsd
    )}) · 24ч: ${formatPercent(snapshot.priceChange24hPct)}`
  );

  lines.push(
    `🏦 <b>FDV:</b> ${formatUsd(snapshot.fdvUsd)}  •  💧 <b>LP:</b> ${formatUsd(
      snapshot.liquidityUsd
    )}`
  );
  lines.push(
    `📊 <b>VOL 24ч:</b> ${formatUsd(snapshot.volume24hUsd)}  •  🔁 <b>TXNS 24ч:</b> ${formatCount(
      snapshot.txns24h
    )}`
  );
  if (snapshot.holders !== undefined && snapshot.holders !== null) {
    lines.push(`👥 <b>Холдеры:</b> ${formatCount(snapshot.holders)}`);
  }
  lines.push(
    `🔒 <b>LP Лок:</b> ${formatBooleanText(snapshot.lpLocked)}  •  👑 <b>Отказ:</b> ${formatBooleanText(
      snapshot.ownershipRenounced
    )}`
  );
  lines.push('');

  lines.push(`🔗 <b>Адрес:</b> <code>${snapshot.address}</code>`);
  if (snapshot.description) {
    lines.push(`📝 ${escapeHtml(snapshot.description).slice(0, 320)}`);
  }
  if (snapshot.links.length) {
    lines.push(
      snapshot.links
        .map((link) => `• <a href="${link.url}">${escapeHtml(link.title)}</a>`)
        .join('  ')
    );
  }
  lines.push(`🕒 Обновлено: ${relativeTime(snapshot.updatedAt)}`);
  return lines.join('\n');
}



export function buildTokenKeyboard(
  address: string,
  snapshot: TokenSnapshot,
  context?: TradingContext | null,
  options?: { callbackId?: string }
) {
  const profile = context?.profile ?? null;
  const wallets = context?.wallets ?? [];
  const tonPrice = snapshot.tonPriceUsd ?? 0;
  const mode: 'buy' | 'sell' = profile?.trade_mode === 'sell' ? 'sell' : 'buy';
  const tonAmount = profile?.ton_amount ?? QUICK_TON_AMOUNTS[0];
  const sellPercent = profile?.sell_percent ?? QUICK_PERCENT_VALUES[0];
  const buyLimit = profile?.buy_limit_price ?? null;
  const activeWallet = profile?.active_wallet_id
    ? wallets.find((w) => w.id === profile.active_wallet_id) || null
    : wallets[0] || null;
  const callbackKey = options?.callbackId || address;
  const walletLabel = activeWallet
    ? `👛 ${shortAddress(activeWallet.address)} · ${walletBalanceTon(activeWallet)} TON`
    : wallets.length
    ? '👛 Выбрать кошелёк'
    : '👛 Добавить кошелёк';
  const walletAction = wallets.length
    ? `trade_wallet_menu:${callbackKey}`
    : 'trade_wallet_create';

  const rows: ReturnType<typeof Markup.inlineKeyboard>['reply_markup']['inline_keyboard'] = [
    [
      Markup.button.callback('🔄 Обновить', `token_refresh:${callbackKey}`),
      Markup.button.callback('📤 Поделиться', `token_share:${callbackKey}`),
    ],
    [Markup.button.callback(walletLabel, walletAction)],
    [
      Markup.button.callback(
        `${mode === 'buy' ? '✅ ' : ''}Покупка`,
        `trade_mode:${callbackKey}:buy`
      ),
      Markup.button.callback(
        `${mode === 'sell' ? '✅ ' : ''}Продажа`,
        `trade_mode:${callbackKey}:sell`
      ),
    ],
  ];

  const quickValues = mode === 'buy' ? QUICK_TON_AMOUNTS : QUICK_PERCENT_VALUES;
  chunkArray(quickValues, 2).forEach((chunk) => {
    rows.push(
      chunk.map((value) => {
        if (mode === 'buy') {
          const active = Number(tonAmount ?? 0) === value;
          const label = `${active ? '✅ ' : ''}${formatTonWithApproxUsd(value, tonPrice)}`;
          return Markup.button.callback(label, `trade_quick:${callbackKey}:buy:${value}`);
        }
        const active = Number(sellPercent ?? 0) === value;
        const label = `${active ? '✅ ' : ''}${value}%`;
        return Markup.button.callback(label, `trade_quick:${callbackKey}:sell:${value}`);
      })
    );
  });

  const customRow = [
    Markup.button.callback(
      formatCustomPrimaryLabel(mode, tonAmount, sellPercent),
      `trade_custom_primary:${callbackKey}:${mode}`
    ),
  ];
  if (mode === 'buy') {
    customRow.push(
      Markup.button.callback(
        formatLimitPriceLabel(buyLimit),
        `trade_custom_price:${callbackKey}`
      )
    );
  }
  rows.push(customRow);

  rows.push([
    Markup.button.callback('🚀 Запустить свап', `trade_swap:${callbackKey}`),
  ]);

  rows.push([
    Markup.button.url('STON.fi 🌐', `https://app.ston.fi/swap?ft=TON&tt=${address}`),
    Markup.button.url('DeDust ⚡️', `https://dedust.io/swap/TON/${address}`),
  ]);

  rows.push([Markup.button.callback('🙈 Скрыть', `token_hide:${callbackKey}`)]);
  rows.push([Markup.button.callback('⬅️ Меню', 'menu_home')]);

  return Markup.inlineKeyboard(rows);
}

export async function fetchTokenSearchResults(
  query: string
): Promise<TokenSearchItem[]> {
  const trimmed = query?.trim() || '';

  if (!trimmed) {
    return getPopularTokenSearchResults();
  }

  const normalized = normalizeJettonAddress(trimmed);
  const [{ items, map }, tickers, tonPriceUsd] = await Promise.all([
    loadDedustAssets(),
    fetchDedustTickers(),
    getTonPriceUsd(),
  ]);

  const matchedAssets: DedustAsset[] = [];

  if (normalized) {
    const asset = map.get(normalized);
    if (asset) {
      matchedAssets.push(asset);
    } else {
      const metadata = await fetchDedustMetadata(normalized).catch(() => null);
      if (metadata) {
        matchedAssets.push({
          type: 'jetton',
          address: normalized,
          name: metadata.name,
          symbol: metadata.symbol,
          image: metadata.image,
          decimals: metadata.decimals,
        });
      }
    }
  } else {
    for (const asset of items) {
      if (dedustAssetMatchesQuery(asset, trimmed)) {
        matchedAssets.push(asset);
        if (matchedAssets.length >= MAX_INLINE_RESULTS * 2) break;
      }
    }
  }

  const tokens = matchedAssets
    .map((asset) => {
      const address = dedustAssetAddress(asset);
      if (!address) return null;
      const ticker = selectDedustTicker(address, tickers);
      if (!ticker) return null;
      return buildTokenSearchItemFromTicker(address, asset, ticker, tonPriceUsd);
    })
    .filter((token): token is TokenSearchItem => Boolean(token));

  if (tokens.length) {
    return dedupeTokens(tokens);
  }

  return getPopularTokenSearchResults();
}

export function tradingInstructionsView() {
  return {
    text: [
      '🚀 Торговля через DeDust',
      '💬 Отправь адрес jetton или воспользуйся поиском ниже.',
      '🧠 Мы подтянем цену, FDV, ликвидность и трейды напрямую из DeDust.',
      '👛 Выбери кошелёк и режим покупки/продажи, задай сумму TON или %.',
      '⚡ Нажимай «Запустить свап», чтобы заявка ушла на наш бэкенд.',
    ].join('\n'),
    keyboard: Markup.inlineKeyboard([
      [Markup.button.switchToCurrentChat('🔍 Найти токен', '')],
      [Markup.button.callback('⬅️ Меню', 'menu_home')],
    ]),
  };
}



