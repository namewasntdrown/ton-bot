import axios from 'axios';
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

const POPULAR_TOKENS: TokenSearchItem[] = [
  {
    name: 'Tether USD',
    symbol: 'USDT',
    address: 'EQC-fot1i1DWJY7L2RPGu-Q0L8M1c01qmPvvrLwR5c-h3t82',
    image:
      'https://public.tonapi.io/jetton/EQC-fot1i1DWJY7L2RPGu-Q0L8M1c01qmPvvrLwR5c-h3t82/image',
    fdvUsd: 1_000_000_000,
    liquidityUsd: 120_000_000,
    volume24hUsd: 80_000_000,
    priceChange24hPct: 0.02,
  },
  {
    name: 'Notcoin',
    symbol: 'NOT',
    address: 'EQD9cs1g7rCB32CdFh4Lu7kte-ij6euuFmYvc8b6k2m2HiyS',
    image:
      'https://public.tonapi.io/jetton/EQD9cs1g7rCB32CdFh4Lu7kte-ij6euuFmYvc8b6k2m2HiyS/image',
    fdvUsd: 1_900_000_000,
    liquidityUsd: 65_000_000,
    volume24hUsd: 150_000_000,
    priceChange24hPct: -1.35,
  },
  {
    name: 'S.O.T.A',
    symbol: 'SOTA',
    address: 'EQC3ZfAoJj1b0cb1tJ4Olv5lybK1I9IqCpSCqu211d3J0Q2y',
    image:
      'https://public.tonapi.io/jetton/EQC3ZfAoJj1b0cb1tJ4Olv5lybK1I9IqCpSCqu211d3J0Q2y/image',
    fdvUsd: 18_000_000,
    liquidityUsd: 6_500_000,
    volume24hUsd: 210_000,
    priceChange24hPct: 2.1,
  },
  {
    name: 'Ecopray',
    symbol: 'ECOR',
    address: 'EQCN4p-8PFqdrF7NlaL3GQBhNhVGLYVbS-J0FWSsLyQ5pIwA',
    image:
      'https://public.tonapi.io/jetton/EQCN4p-8PFqdrF7NlaL3GQBhNhVGLYVbS-J0FWSsLyQ5pIwA/image',
    fdvUsd: 320_000_000,
    liquidityUsd: 960_000,
    volume24hUsd: 33_000,
    priceChange24hPct: 3.5,
  },
  {
    name: 'Blum',
    symbol: 'BLUM',
    address: 'EQCAj5oiRRrXokYsg_B-e0KG9xMwh5upr5I8HQzErm0_BLUM',
    image:
      'https://public.tonapi.io/jetton/EQCAj5oiRRrXokYsg_B-e0KG9xMwh5upr5I8HQzErm0_BLUM/image',
    fdvUsd: 500_000_000,
    liquidityUsd: 25_000_000,
    volume24hUsd: 20_000_000,
    priceChange24hPct: -5.86,
  },
];

const DEXSCREENER_API =
  process.env.DEXSCREENER_API || 'https://api.dexscreener.com/latest/dex';
const TONAPI_BASE_URL = process.env.TONAPI_BASE_URL || 'https://tonapi.io/v2';
const TONAPI_API_KEY = process.env.TONAPI_API_KEY || '';
const COINGECKO_PRICE_URL =
  process.env.COINGECKO_PRICE_URL ||
  'https://api.coingecko.com/api/v3/simple/price';
const TON_ADDRESS_RE = /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/;
const MAX_INLINE_RESULTS = 120;

export const tokenSnapshotCache = new Map<string, TokenSnapshot>();
const tonPriceCache = { value: 0, fetchedAt: 0 };
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

export function normalizeJettonAddress(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/\s+/g, '');
  if (TON_ADDRESS_RE.test(clean)) return clean;
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

function filterTonPairs(pairs: any[]) {
  return (pairs || []).filter(
    (pair) => (pair?.chainId || '').toLowerCase() === 'ton'
  );
}

function sortByLiquidity(pairs: any[]) {
  return [...pairs].sort(
    (a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0)
  );
}

function mapDexPairToToken(pair: any): TokenSearchItem | null {
  const base = pair?.baseToken;
  if (!base?.address) return null;
  return {
    address: base.address,
    name: base.name || base.symbol || 'Token',
    symbol: base.symbol,
    image: pair?.info?.imageUrl || base.logoURI,
    fdvUsd: numberFrom(pair?.fdv, pair?.marketCap),
    liquidityUsd: numberFrom(pair?.liquidity?.usd, pair?.liquidityUsd),
    volume24hUsd: numberFrom(
      pair?.volume24h?.usd,
      pair?.volumeUsd24h,
      pair?.volume?.h24?.usd
    ),
    priceChange24hPct: numberFrom(
      pair?.priceChange?.h24,
      pair?.priceChange24h
    ),
  };
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
    add(`Website ${idx + 2}`, url)
  );
  (Array.isArray(socials) ? socials : []).forEach((url: string) => {
    if (url?.includes('twitter.com')) add('Twitter', url);
    else if (url?.includes('telegram')) add('Telegram', url);
  });
  add('GitHub', meta?.github);
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
  add('Telegram', meta?.telegram);
  add('CoinMarketCap', meta?.cmc);
  add('CoinGecko', meta?.coingecko);
  add('DexScreener', info?.url);

  return Array.from(links.values()).slice(0, 6);
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

  const [dexRes, tonapiRes, tonPriceUsd] = await Promise.allSettled([
    axios.get(`${DEXSCREENER_API}/tokens/${address}`, { timeout: 10_000 }),
    loadTonapiJetton(address),
    getTonPriceUsd(),
  ]);

  if (dexRes.status === 'rejected') {
    throw new Error('Не удалось получить данные с Dexscreener');
  }
  const pairs = filterTonPairs(dexRes.value?.data?.pairs || []);
  if (!pairs.length) {
    throw new Error('Токен не найден на Dexscreener');
  }
  const bestPair = sortByLiquidity(pairs)[0];
  const base = bestPair?.baseToken || {};
  const info = bestPair?.info || {};

  const tonapiMeta = tonapiRes.status === 'fulfilled' ? tonapiRes.value : null;
  const tonUsd =
    tonPriceUsd.status === 'fulfilled' ? tonPriceUsd.value : undefined;

  const priceUsd = numberFrom(bestPair?.priceUsd, bestPair?.priceInUsd);
  const nativePrice = numberFrom(
    bestPair?.priceNative,
    bestPair?.priceInNative
  );
  const priceTon =
    nativePrice ||
    (priceUsd && tonUsd ? Number(priceUsd) / Number(tonUsd) : undefined);

  const txns24h =
    numberFrom(
      bestPair?.txns?.h24?.buys,
      bestPair?.txns?.h24?.sells
    ) !== undefined
      ? Number(bestPair?.txns?.h24?.buys || 0) +
        Number(bestPair?.txns?.h24?.sells || 0)
      : undefined;
  const txns1h =
    numberFrom(
      bestPair?.txns?.h1?.buys,
      bestPair?.txns?.h1?.sells
    ) !== undefined
      ? Number(bestPair?.txns?.h1?.buys || 0) +
        Number(bestPair?.txns?.h1?.sells || 0)
      : undefined;

  const snapshot: TokenSnapshot = {
    address,
    name: tonapiMeta?.name || base.name || base.symbol,
    symbol: tonapiMeta?.symbol || base.symbol,
    description:
      tonapiMeta?.description || tonapiMeta?.metadata?.description || '',
    image: tonapiMeta?.image || info?.imageUrl || base.logoURI,
    priceUsd: priceUsd ? Number(priceUsd) : undefined,
    priceTon,
    tonPriceUsd: tonUsd,
    fdvUsd: numberFrom(bestPair?.fdv, bestPair?.marketCap),
    liquidityUsd: numberFrom(
      bestPair?.liquidity?.usd,
      bestPair?.liquidityUsd
    ),
    volume24hUsd: numberFrom(
      bestPair?.volume24h?.usd,
      bestPair?.volumeUsd24h
    ),
    txns24h,
    txns1h,
    priceChange1hPct: numberFrom(
      bestPair?.priceChange?.h1,
      bestPair?.priceChange1h
    ),
    priceChange6hPct: numberFrom(
      bestPair?.priceChange?.h6,
      bestPair?.priceChange6h
    ),
    priceChange24hPct: numberFrom(
      bestPair?.priceChange?.h24,
      bestPair?.priceChange24h
    ),
    links: buildExternalLinks(address, tonapiMeta, {
      ...info,
      url: bestPair?.url,
    }),
    updatedAt: Date.now(),
  };

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
  try {
    let pairs: any[] = [];
    if (query) {
      const { data } = await axios.get(`${DEXSCREENER_API}/search`, {
        params: { q: query },
        timeout: 10_000,
      });
      pairs = filterTonPairs(data?.pairs || []);
    } else {
      const { data } = await axios.get(`${DEXSCREENER_API}/pairs/ton`, {
        timeout: 10_000,
      });
      pairs = data?.pairs || [];
    }
    const tokens = dedupeTokens(
      pairs
        .map(mapDexPairToToken)
        .filter(
          (token: TokenSearchItem | null): token is TokenSearchItem =>
            Boolean(token)
        )
    );
    if (tokens.length) return tokens;
  } catch (err: any) {
    console.warn('dex token search failed:', err?.message);
  }

  const lowered = query?.toLowerCase();
  return POPULAR_TOKENS.filter((token: TokenSearchItem) =>
    lowered
      ? token.name.toLowerCase().includes(lowered) ||
        token.symbol?.toLowerCase().includes(lowered)
      : true
  ).slice(0, MAX_INLINE_RESULTS);
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
