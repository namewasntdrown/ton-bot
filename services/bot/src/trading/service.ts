import axios from 'axios';
import type { Buffer } from 'buffer';
import { Markup } from 'telegraf';

export type ExternalLink = { title: string; url: string };
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
  links: ExternalLink[];
  chartImage?: Buffer;
  source?: 'ston';
  updatedAt: number;
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

type PopularTokenConfig = Pick<
  TokenSearchItem,
  'address' | 'name' | 'symbol' | 'image'
>;

type MemeRepublicLeaderboardEntry = {
  symbol?: string;
  token_address?: string;
  market_cap?: number | string;
  liquidity?: number | string;
  volume_h24?: number | string;
  price_change_24h?: number | string;
  logo_url?: string;
  rank?: number;
};

type MemeRepublicLeaderboardResponse = {
  leaderboard?: MemeRepublicLeaderboardEntry[];
};

type StonAsset = {
  contract_address: string;
  symbol?: string;
  display_name?: string;
  image_url?: string;
  decimals?: number;
  dex_price_usd?: string;
  third_party_price_usd?: string;
  meta?: {
    symbol?: string;
    display_name?: string;
    image_url?: string;
    dex_price_usd?: string;
  };
};

type StonAssetResponse = {
  asset?: StonAsset;
};

type StonAssetListResponse = {
  asset_list?: StonAsset[];
};

type StonPoolInfo = {
  address: string;
  router_address?: string;
  reserve0?: string;
  reserve1?: string;
  token0_address: string;
  token1_address: string;
  lp_total_supply_usd?: string;
  volume_24h_usd?: string;
};

type StonPoolListResponse = {
  pool_list?: StonPoolInfo[];
};

type StonPoolStat = {
  pool_address: string;
  url?: string;
  base_id?: string;
  base_name?: string;
  base_symbol?: string;
  base_liquidity?: string;
  base_volume?: string;
  quote_id?: string;
  quote_name?: string;
  quote_symbol?: string;
  quote_liquidity?: string;
  quote_volume?: string;
  last_price?: string;
  lp_price_usd?: string;
};

type StonPoolStatsResponse = {
  stats?: StonPoolStat[];
};

const POPULAR_TOKENS: PopularTokenConfig[] = [
  {
    name: 'Tether USD',
    symbol: 'USDT',
    address: 'EQC-fot1i1DWJY7L2RPGu-Q0L8M1c01qmPvvrLwR5c-h3t82',
    image:
      'https://public.tonapi.io/jetton/EQC-fot1i1DWJY7L2RPGu-Q0L8M1c01qmPvvrLwR5c-h3t82/image',
  },
  {
    name: 'Notcoin',
    symbol: 'NOT',
    address: 'EQD9cs1g7rCB32CdFh4Lu7kte-ij6euuFmYvc8b6k2m2HiyS',
    image:
      'https://public.tonapi.io/jetton/EQD9cs1g7rCB32CdFh4Lu7kte-ij6euuFmYvc8b6k2m2HiyS/image',
  },
  {
    name: 'S.O.T.A',
    symbol: 'SOTA',
    address: 'EQC3ZfAoJj1b0cb1tJ4Olv5lybK1I9IqCpSCqu211d3J0Q2y',
    image:
      'https://public.tonapi.io/jetton/EQC3ZfAoJj1b0cb1tJ4Olv5lybK1I9IqCpSCqu211d3J0Q2y/image',
  },
  {
    name: 'Ecopray',
    symbol: 'ECOR',
    address: 'EQCN4p-8PFqdrF7NlaL3GQBhNhVGLYVbS-J0FWSsLyQ5pIwA',
    image:
      'https://public.tonapi.io/jetton/EQCN4p-8PFqdrF7NlaL3GQBhNhVGLYVbS-J0FWSsLyQ5pIwA/image',
  },
  {
    name: 'Blum',
    symbol: 'BLUM',
    address: 'EQCAj5oiRRrXokYsg_B-e0KG9xMwh5upr5I8HQzErm0_BLUM',
    image:
      'https://public.tonapi.io/jetton/EQCAj5oiRRrXokYsg_B-e0KG9xMwh5upr5I8HQzErm0_BLUM/image',
  },
];

const TONAPI_BASE_URL = process.env.TONAPI_BASE_URL || 'https://tonapi.io/v2';
const TONAPI_API_KEY = process.env.TONAPI_API_KEY || '';
const COINGECKO_PRICE_URL =
  process.env.COINGECKO_PRICE_URL ||
  'https://api.coingecko.com/api/v3/simple/price';
const STON_API_BASE_URL =
  process.env.STON_API_BASE_URL || 'https://api.ston.fi';
const STON_TON_ASSET_ADDRESS =
  process.env.STON_TON_ASSET_ADDRESS ||
  'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const STON_PROXY_TON_ADDRESS =
  process.env.STON_PROXY_TON_ADDRESS ||
  'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S';
const STON_CHART_WINDOW_HOURS = Number(
  process.env.STON_CHART_WINDOW_HOURS || '6'
);
const STON_CHART_POINTS = Math.min(
  Number(process.env.STON_CHART_POINTS || '12'),
  24
);
const STON_HISTORY_WINDOW_MINUTES = Number(
  process.env.STON_HISTORY_WINDOW_MINUTES || '10'
);
const MEMEREPUBLIC_LEADERBOARD_URL =
  process.env.MEMEREPUBLIC_LEADERBOARD_URL ||
  'https://memelandia.okhlopkov.com/api/leaderboard';
const TON_ADDRESS_RE = /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/;
const TON_ADDRESS_SEARCH_RE = /(?:EQ|UQ)[A-Za-z0-9_-]{46}/;
const MAX_INLINE_RESULTS = 120;
const POPULAR_TOKEN_CACHE_TTL = 30_000;

export const tokenSnapshotCache = new Map<string, TokenSnapshot>();
const tonPriceCache = { value: 0, fetchedAt: 0 };
const popularTokenCache = { tokens: [] as TokenSearchItem[], fetchedAt: 0 };
const stonPoolCache = new Map<
  string,
  { pools: StonPoolInfo[]; fetchedAt: number }
>();
const STON_POOL_CACHE_TTL = 30_000;
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

export function normalizeJettonAddress(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/\s+/g, '');
  if (TON_ADDRESS_RE.test(clean)) return clean;
  const match = raw.match(TON_ADDRESS_SEARCH_RE);
  if (match) return match[0];
  return null;
}

function numberFrom(...values: any[]): number | undefined {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

export function formatUsd(value?: number): string {
  if (value === undefined) return '—';
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  return `$${compactNumberFormatter.format(value)}`;
}

function formatTonValue(value?: number): string {
  if (value === undefined) return '—';
  if (Math.abs(value) >= 1) {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  }
  return value.toFixed(6);
}

export function formatPercent(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
const STON_TON_LIKE_ADDRESSES = new Set([
  STON_TON_ASSET_ADDRESS,
  STON_PROXY_TON_ADDRESS,
]);

function isTonLike(address?: string, symbol?: string) {
  if (address && STON_TON_LIKE_ADDRESSES.has(address)) return true;
  const upper = symbol?.toUpperCase() || '';
  if (!upper) return false;
  return upper === 'TON' || upper === 'PTON' || upper === 'WTON';
}

function formatStonDate(date: Date) {
  return date.toISOString().slice(0, 19);
}

async function loadTonapiJetton(address: string) {
  const headers = TONAPI_API_KEY
    ? { Authorization: `Bearer ${TONAPI_API_KEY}` }
    : undefined;
  try {
    const { data } = await axios.get(`${TONAPI_BASE_URL}/jetton/${address}`, {
      headers,
      timeout: 10_000,
    });
    return data?.jetton ?? data;
  } catch {
    try {
      const { data } = await axios.get(
        `${TONAPI_BASE_URL}/jetton/_/${address}`,
        { headers, timeout: 10_000 }
      );
      return data?.jetton ?? data;
    } catch {
      return null;
    }
  }
}

async function fetchStonAsset(address: string): Promise<StonAsset | null> {
  try {
    const { data } = await axios.get<StonAssetResponse>(
      `${STON_API_BASE_URL}/v1/assets/${address}`,
      { timeout: 10_000 }
    );
    return data?.asset ?? null;
  } catch {
    return null;
  }
}

async function fetchStonPools(address: string): Promise<StonPoolInfo[]> {
  const cached = stonPoolCache.get(address);
  if (cached && Date.now() - cached.fetchedAt < STON_POOL_CACHE_TTL) {
    return cached.pools;
  }
  try {
    const { data } = await axios.post<StonPoolListResponse>(
      `${STON_API_BASE_URL}/v1/pools/query`,
      {
        search_terms: [address],
        limit: 10,
      },
      { timeout: 10_000 }
    );
    const pools = data?.pool_list ?? [];
    stonPoolCache.set(address, { pools, fetchedAt: Date.now() });
    return pools;
  } catch {
    return [];
  }
}

async function fetchStonPoolStatSingle(
  poolAddress: string,
  since: Date,
  until: Date
): Promise<StonPoolStat | null> {
  try {
    const { data } = await axios.get<StonPoolStatsResponse>(
      `${STON_API_BASE_URL}/v1/stats/pool`,
      {
        params: {
          since: formatStonDate(since),
          until: formatStonDate(until),
          pool_address: poolAddress,
        },
        timeout: 10_000,
      }
    );
    if (!data?.stats?.length) return null;
    return data.stats[0];
  } catch {
    return null;
  }
}

async function fetchHistoricalPriceUsd(
  poolAddress: string,
  hoursAgo: number,
  tonPriceUsd?: number
): Promise<number | undefined> {
  if (!tonPriceUsd) return undefined;
  const end = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const start = new Date(end.getTime() - STON_HISTORY_WINDOW_MINUTES * 60 * 1000);
  const stat = await fetchStonPoolStatSingle(poolAddress, start, end);
  const price = resolveStonPrice(stat, tonPriceUsd);
  return price.priceUsd;
}

async function buildChartImageBuffer(
  poolAddress: string,
  tonPriceUsd?: number
): Promise<Buffer | undefined> {
  if (!tonPriceUsd || STON_CHART_POINTS < 2) return undefined;
  const totalMs = STON_CHART_WINDOW_HOURS * 60 * 60 * 1000;
  const stepMs = totalMs / (STON_CHART_POINTS - 1 || 1);
  const now = Date.now();
  const samples = await Promise.all(
    Array.from({ length: STON_CHART_POINTS }).map((_, idx) => {
      const until = new Date(now - (STON_CHART_POINTS - 1 - idx) * stepMs);
      const since = new Date(
        until.getTime() - STON_HISTORY_WINDOW_MINUTES * 60 * 1000
      );
      return fetchStonPoolStatSingle(poolAddress, since, until).then((stat) => {
        const price = resolveStonPrice(stat, tonPriceUsd);
        return price.priceUsd
          ? { time: until, value: price.priceUsd }
          : null;
      });
    })
  );
  const points = samples.filter(
    (pt): pt is { time: Date; value: number } => Boolean(pt)
  );
  if (points.length < 2) return undefined;
  const labels = points.map((pt) => pt.time.toISOString().slice(11, 16));
  const values = points.map((pt) => Number(pt.value.toFixed(6)));
  const color = values[values.length - 1] >= values[0] ? '#2bd67b' : '#ff5f5f';
  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: color,
          borderWidth: 3,
          fill: false,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: false,
      legend: { display: false },
      tooltips: { enabled: false },
      scales: {
        xAxes: [{ display: false }],
        yAxes: [{ display: false }],
      },
      elements: { point: { radius: 0 } },
      layout: { padding: 6 },
    },
  };
  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  const url = `https://quickchart.io/chart?width=600&height=260&format=png&backgroundColor=transparent&c=${encoded}&v=${Date.now()}`;
  try {
    const { data } = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 10_000,
    });
    return Buffer.from(data);
  } catch (err: any) {
    console.warn('quickchart fetch failed:', err?.message);
    return undefined;
  }
}

async function fetchStonTotalSupply(
  address: string
): Promise<number | undefined> {
  try {
    const { data } = await axios.get<{
      asset?: { totalSupply?: string };
    }>(`${STON_API_BASE_URL}/export/dexscreener/v1/asset/${address}`, {
      timeout: 10_000,
    });
    return numberFrom(data?.asset?.totalSupply);
  } catch {
    return undefined;
  }
}

function selectBestStonPool(
  pools: StonPoolInfo[],
  tokenAddress: string
): StonPoolInfo | null {
  if (!pools.length) return null;
  const preferred = pools.filter((pool) => {
    const token0 = pool.token0_address === tokenAddress;
    const token1 = pool.token1_address === tokenAddress;
    const ton0 = isTonLike(pool.token0_address);
    const ton1 = isTonLike(pool.token1_address);
    return (token0 && ton1) || (token1 && ton0);
  });
  const list = preferred.length ? preferred : pools;
  return list
    .slice()
    .sort(
      (a, b) =>
        (numberFrom(b.volume_24h_usd) || 0) -
        (numberFrom(a.volume_24h_usd) || 0)
    )[0];
}

function resolveStonPrice(
  stat: StonPoolStat | null,
  tonPriceUsd?: number
): { priceTon?: number; priceUsd?: number; baseIsTon?: boolean } {
  if (!stat) return {};
  const lastPrice = numberFrom(stat.last_price);
  if (!lastPrice || !tonPriceUsd) return {};
  const baseIsTon = isTonLike(stat.base_id, stat.base_symbol);
  const quoteIsTon = isTonLike(stat.quote_id, stat.quote_symbol);
  if (baseIsTon && !quoteIsTon) {
    const priceTon = 1 / lastPrice;
    return { priceTon, priceUsd: priceTon * tonPriceUsd, baseIsTon: true };
  }
  if (quoteIsTon && !baseIsTon) {
    const priceTon = lastPrice;
    return { priceTon, priceUsd: priceTon * tonPriceUsd, baseIsTon: false };
  }
  return {};
}

function computePercentChange(
  current?: number,
  previous?: number
): number | undefined {
  if (
    current === undefined ||
    previous === undefined ||
    previous === 0 ||
    Number.isNaN(current) ||
    Number.isNaN(previous)
  ) {
    return undefined;
  }
  return ((current - previous) / previous) * 100;
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

async function searchStonAssets(
  query: string,
  limit = 10
): Promise<StonAsset[]> {
  try {
    const { data } = await axios.post<StonAssetListResponse>(
      `${STON_API_BASE_URL}/v1/assets/query`,
      {
        search_terms: [query],
        limit,
      },
      { timeout: 10_000 }
    );
    return data?.asset_list ?? [];
  } catch (err: any) {
    console.warn('ston asset search failed:', err?.message);
    return [];
  }
}

async function buildTokenSearchItemFromAsset(
  asset: StonAsset
): Promise<TokenSearchItem | null> {
  const pools = await fetchStonPools(asset.contract_address);
  const pool = selectBestStonPool(pools, asset.contract_address);
  if (!pool) return null;
  const name =
    asset.display_name ||
    asset.meta?.display_name ||
    asset.symbol ||
    asset.meta?.symbol ||
    'Token';
  const symbol = asset.symbol || asset.meta?.symbol;
  const image = asset.image_url || asset.meta?.image_url;
  const liquidityUsd = numberFrom(pool.lp_total_supply_usd);
  const volume24hUsd = numberFrom(pool.volume_24h_usd);
  const fdvUsd = undefined;
  return {
    address: asset.contract_address,
    name,
    symbol,
    image,
    fdvUsd,
    liquidityUsd,
    volume24hUsd,
    priceChange24hPct: undefined,
  };
}

function mapMemerepublicEntryToToken(
  entry: MemeRepublicLeaderboardEntry
): TokenSearchItem | null {
  if (!entry?.token_address) return null;
  const symbol = entry.symbol?.trim();
  if (!symbol) return null;
  const address =
    normalizeJettonAddress(entry.token_address) || entry.token_address;
  return {
    address,
    name: symbol,
    symbol,
    image: entry.logo_url,
    fdvUsd: numberFrom(entry.market_cap),
    liquidityUsd: numberFrom(entry.liquidity),
    volume24hUsd: numberFrom(entry.volume_h24),
    priceChange24hPct: numberFrom(entry.price_change_24h),
  };
}

async function fetchMemerepublicTokenSearchResults(): Promise<TokenSearchItem[]> {
  try {
    const { data } = await axios.get<MemeRepublicLeaderboardResponse>(
      MEMEREPUBLIC_LEADERBOARD_URL,
      { timeout: 10_000 }
    );
    const rows = data?.leaderboard || [];
    if (!rows.length) return [];
    const tokens = [...rows]
      .sort(
        (a, b) =>
          (a.rank ?? Number.MAX_SAFE_INTEGER) -
          (b.rank ?? Number.MAX_SAFE_INTEGER)
      )
      .map(mapMemerepublicEntryToToken)
      .filter(
        (token): token is TokenSearchItem => Boolean(token)
      );
    return dedupeTokens(tokens);
  } catch (err: any) {
    console.warn('memerepublic leaderboard fetch failed:', err?.message);
    return [];
  }
}

function popularTokenToSearchItem(token: PopularTokenConfig): TokenSearchItem {
  return {
    address: token.address,
    name: token.name,
    symbol: token.symbol,
    image: token.image,
  };
}

async function getPopularTokenSearchResults(): Promise<TokenSearchItem[]> {
  if (
    popularTokenCache.tokens.length &&
    Date.now() - popularTokenCache.fetchedAt < POPULAR_TOKEN_CACHE_TTL
  ) {
    return popularTokenCache.tokens;
  }

  const memeRepublicTokens = await fetchMemerepublicTokenSearchResults();
  if (memeRepublicTokens.length) {
    popularTokenCache.tokens = memeRepublicTokens;
    popularTokenCache.fetchedAt = Date.now();
    return memeRepublicTokens;
  }

  try {
    const responses = await Promise.all(
      POPULAR_TOKENS.map(async (token) => {
        const asset =
          (await fetchStonAsset(token.address)) ?? ({
            contract_address: token.address,
            symbol: token.symbol,
            display_name: token.name,
            image_url: token.image,
          } as StonAsset);
        return buildTokenSearchItemFromAsset(asset);
      })
    );
    const tokens = dedupeTokens(
      responses.filter((token): token is TokenSearchItem => Boolean(token))
    );
    if (tokens.length) {
      popularTokenCache.tokens = tokens;
      popularTokenCache.fetchedAt = Date.now();
      return tokens;
    }
  } catch (err: any) {
    console.warn('popular tokens refresh failed:', err?.message);
  }

  return POPULAR_TOKENS.slice(0, MAX_INLINE_RESULTS).map(
    popularTokenToSearchItem
  );
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
  if (diff < 60_000) return 'меньше минуты назад';
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

  add('STON.fi', `https://app.ston.fi/swap?ft=TON&tt=${address}`);
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

async function fetchStonTokenSnapshot(
  address: string
): Promise<TokenSnapshot | null> {
  const [assetRes, poolsRes, tonapiRes, totalSupply] = await Promise.all([
    fetchStonAsset(address),
    fetchStonPools(address),
    loadTonapiJetton(address).catch(() => null),
    fetchStonTotalSupply(address),
  ]);

  const asset = assetRes;
  const pools = poolsRes;
  const tonapiMeta = tonapiRes;
  const tonPriceUsd = await getTonPriceUsd();

  if (!asset || !pools.length || !tonPriceUsd) {
    return null;
  }

  const pool = selectBestStonPool(pools, address);
  if (!pool) return null;

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const stat = await fetchStonPoolStatSingle(pool.address, dayAgo, now);
  if (!stat) return null;

  const priceInfo = resolveStonPrice(stat, tonPriceUsd);
  if (!priceInfo.priceUsd) return null;

  const [price1h, price6h, price24h] = await Promise.all([
    fetchHistoricalPriceUsd(pool.address, 1, tonPriceUsd),
    fetchHistoricalPriceUsd(pool.address, 6, tonPriceUsd),
    fetchHistoricalPriceUsd(pool.address, 24, tonPriceUsd),
  ]);

  const baseLiquidity = numberFrom(stat.base_liquidity);
  const quoteLiquidity = numberFrom(stat.quote_liquidity);
  const lpUsd = numberFrom(pool.lp_total_supply_usd);
  let liquidityUsd = lpUsd ?? numberFrom(stat.lp_price_usd);
  if (priceInfo.baseIsTon && baseLiquidity !== undefined) {
    liquidityUsd =
      baseLiquidity * tonPriceUsd +
      (quoteLiquidity !== undefined && priceInfo.priceUsd
        ? quoteLiquidity * priceInfo.priceUsd
        : 0);
  } else if (!priceInfo.baseIsTon && quoteLiquidity !== undefined) {
    liquidityUsd =
      quoteLiquidity * tonPriceUsd +
      (baseLiquidity !== undefined && priceInfo.priceUsd
        ? baseLiquidity * priceInfo.priceUsd
        : 0);
  }

  const poolVolumeUsd = numberFrom(pool.volume_24h_usd);
  const baseVolume = numberFrom(stat.base_volume);
  const volume24hUsd =
    poolVolumeUsd ||
    (baseVolume !== undefined && tonPriceUsd
      ? baseVolume * tonPriceUsd
      : undefined);

  const fdvUsd =
    totalSupply && priceInfo.priceUsd
      ? totalSupply * priceInfo.priceUsd
      : undefined;
  const chartImage = await buildChartImageBuffer(pool.address, tonPriceUsd);

  const links = buildExternalLinks(address, tonapiMeta, {
    url: stat.url,
  });

  return {
    address,
    name: asset.display_name || tonapiMeta?.name || asset.symbol,
    symbol: asset.symbol || tonapiMeta?.symbol,
    description:
      tonapiMeta?.description || tonapiMeta?.metadata?.description || '',
    image: asset.image_url || tonapiMeta?.image,
    priceUsd: priceInfo.priceUsd,
    priceTon: priceInfo.priceTon,
    tonPriceUsd,
    fdvUsd,
    liquidityUsd,
    volume24hUsd,
    txns24h: undefined,
    txns1h: undefined,
    priceChange1hPct: computePercentChange(priceInfo.priceUsd, price1h),
    priceChange6hPct: computePercentChange(priceInfo.priceUsd, price6h),
    priceChange24hPct: computePercentChange(priceInfo.priceUsd, price24h),
    links,
    chartImage,
    source: 'ston',
    updatedAt: Date.now(),
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

  const snapshot = await fetchStonTokenSnapshot(address);
  if (!snapshot) {
    throw new Error('Failed to fetch token data from STON.fi');
  }
  tokenSnapshotCache.set(address, snapshot);
  return snapshot;
}

export function buildTokenSummary(snapshot: TokenSnapshot): string {
  const lines = [];
  const title = `${snapshot.symbol || snapshot.name || 'Токен'} / USD`;
  const priceLine = snapshot.priceUsd
    ? `${snapshot.priceUsd.toFixed(4)}${
        snapshot.priceTon ? ` · ${formatTonValue(snapshot.priceTon)} TON` : ''
      }`
    : '—';
  lines.push(
    `<b>${escapeHtml(title)}</b> — ${priceLine} | ${formatPercent(
      snapshot.priceChange24hPct
    )}`
  );
  lines.push(
    `FDV ${formatUsd(snapshot.fdvUsd)} · LIQ ${formatUsd(
      snapshot.liquidityUsd
    )}`
  );
  lines.push(
    `VOL 24ч ${formatUsd(snapshot.volume24hUsd)} · TXNS 24ч ${
      snapshot.txns24h ?? '—'
    }`
  );
  lines.push(
    `Δ1ч ${formatPercent(snapshot.priceChange1hPct)} · Δ6ч ${formatPercent(
      snapshot.priceChange6hPct
    )}`
  );
  lines.push('');
  lines.push(`Адрес: <code>${snapshot.address}</code>`);
  if (snapshot.description) {
    lines.push(`📝 ${escapeHtml(snapshot.description).slice(0, 320)}`);
  }
  if (snapshot.links.length) {
    lines.push(
      '🔗 ' +
        snapshot.links
          .map((link) => `<a href="${link.url}">${escapeHtml(link.title)}</a>`)
          .join(' · ')
    );
  }
  lines.push(`Обновлено: ${relativeTime(snapshot.updatedAt)}`);
  return lines.join('\n');
}

export function buildTokenKeyboard(address: string, snapshot: TokenSnapshot) {
  const quikAmounts = [10, 25, 50, 100];
  const tonPrice = snapshot.tonPriceUsd ?? 0;
  const rows = [
    [
      Markup.button.callback('1m', 'noop'),
      Markup.button.callback('5m', 'noop'),
      Markup.button.callback('30m', 'noop'),
      Markup.button.callback('1h', 'noop'),
    ],
    [
      Markup.button.callback('🔄 Обновить', `token_refresh:${address}`),
      Markup.button.callback('📤 Поделиться', `token_share:${address}`),
    ],
    [
      Markup.button.callback('✅ Купить', `token_buy:${address}`),
      Markup.button.callback('💸 Продать', `token_sell:${address}`),
    ],
    [
      ...quikAmounts.slice(0, 2).map((amt) => {
        const usd = tonPrice ? ` ≈ ${formatUsd(amt * tonPrice)}` : '';
        return Markup.button.callback(
          `${amt} TON${usd}`,
          `token_amt:${address}:${amt}`
        );
      }),
      Markup.button.callback('Лимит ордера 📍', `token_limit:${address}`),
    ],
    [
      ...quikAmounts.slice(2).map((amt) => {
        const usd = tonPrice ? ` ≈ ${formatUsd(amt * tonPrice)}` : '';
        return Markup.button.callback(
          `${amt} TON${usd}`,
          `token_amt:${address}:${amt}`
        );
      }),
      Markup.button.callback('🐒 0 TON (?)', `token_amt:${address}:0`),
    ],
    [
      Markup.button.callback('💬 Укажи сумму', `token_custom:${address}`),
      Markup.button.callback('🙈 Скрыть', `token_hide:${address}`),
    ],
    [Markup.button.callback('⬅️ Меню', 'menu_home')],
  ];
  return Markup.inlineKeyboard(rows);
}


export async function fetchTokenSearchResults(
  query: string
): Promise<TokenSearchItem[]> {
  const trimmed = query?.trim() || '';

  if (!trimmed) {
    return getPopularTokenSearchResults();
  }

  try {
    const assets = await searchStonAssets(trimmed, 12);
    const tokens = (
      await Promise.all(
        assets.map((asset) => buildTokenSearchItemFromAsset(asset))
      )
    ).filter((token): token is TokenSearchItem => Boolean(token));
    if (tokens.length) return dedupeTokens(tokens);
  } catch (err: any) {
    console.warn('ston token search failed:', err?.message);
  }

  const lowered = trimmed.toLowerCase();
  return POPULAR_TOKENS.filter((token) =>
    lowered
      ? token.name.toLowerCase().includes(lowered) ||
        token.symbol?.toLowerCase().includes(lowered)
      : true
  )
    .slice(0, MAX_INLINE_RESULTS)
    .map(popularTokenToSearchItem);
}

export function tradingInstructionsView() {
  return {
    text: [
      '🚀 Торговля',
      '💬 Первый шаг к сделке:',
      '• Отправь адрес смарт-контракта токена в чат.',
      '• Мы загрузим цену, ликвидность, объём и дадим быстрые действия.',
      '',
      'Нужен готовый список? Открой поиск и выбери токен.',
    ].join('\n'),
    keyboard: Markup.inlineKeyboard([
      [Markup.button.switchToCurrentChat('🔍 Поиск токенов', '')],
      [Markup.button.callback('⬅️ Меню', 'menu_home')],
    ]),
  };
}


