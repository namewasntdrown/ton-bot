import { Markup, type Telegraf } from 'telegraf';
import {
  fetchUserPositions,
  setUserPositionHidden,
  fetchTokenSnapshot,
  tokenSnapshotCache,
  getTonPriceUsd,
  shortAddress,
  type UserPositionSummary,
  type TokenSnapshot,
} from '../../trading/service';
import { sendView, ViewMode } from '../../utils/telegram';
import {
  showTokenByAddress,
  ensureCallbackAddressId,
  resolveCallbackAddress,
} from '../../trading';

export type PositionsFilter = 'active' | 'hidden';

export function registerPositionActions(bot: Telegraf<any>) {
  bot.action(/^positions_refresh:(active|hidden)$/, async (ctx) => {
    const filter = (ctx.match as RegExpMatchArray)[1] as PositionsFilter;
    await ctx.answerCbQuery('Обновляю');
    await renderPositionsMenu(ctx, filter, 'edit');
  });

  bot.action(/^positions_view:(active|hidden)$/, async (ctx) => {
    const filter = (ctx.match as RegExpMatchArray)[1] as PositionsFilter;
    await ctx.answerCbQuery();
    await renderPositionsMenu(ctx, filter);
  });

  bot.action(/^position_toggle:(\d+):(hide|show):(active|hidden)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Неизвестный пользователь');
      return;
    }
    const [, idStr, action, filter] = ctx.match as RegExpMatchArray;
    const hidden = action === 'hide';
    try {
      await setUserPositionHidden(ctx.from.id, Number(idStr), hidden);
      await ctx.answerCbQuery(hidden ? 'Скрыто' : 'Вернул');
      await renderPositionsMenu(ctx, filter as PositionsFilter, 'edit');
    } catch (err) {
      console.error('position toggle failed', err);
      await ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action(/^position_trade:([^:]+):(active|hidden)$/, async (ctx) => {
    const [, tokenKey] = ctx.match as RegExpMatchArray;
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен не найден');
      return;
    }
    try {
      await ctx.answerCbQuery();
      await showTokenByAddress(ctx, address, 'reply');
    } catch (err) {
      console.error('position trade failed', err);
      await ctx.answerCbQuery('Ошибка');
    }
  });
}

export async function renderPositionsMenu(
  ctx: any,
  filter: PositionsFilter = 'active',
  mode: ViewMode = 'edit'
) {
  const userId = ctx.from?.id;
  if (!userId) {
    return sendView(
      ctx,
      'Не удалось определить пользователя.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Меню', 'menu_home')]]),
      mode
    );
  }
  try {
    const includeHidden = filter === 'hidden';
    const positions = await fetchUserPositions(userId, { includeHidden });
    const filtered =
      filter === 'hidden'
        ? positions.filter((p) => p.is_hidden)
        : positions.filter((p) => !p.is_hidden);

    let cachedTonPriceUsd: number | undefined;
    const ensureTonPriceUsd = async () => {
      if (cachedTonPriceUsd !== undefined) return cachedTonPriceUsd;
      cachedTonPriceUsd = await getTonPriceUsd().catch(() => undefined);
      return cachedTonPriceUsd;
    };

    const enriched = await Promise.all(
      filtered.map(async (position) => {
        let snapshot: TokenSnapshot | null =
          tokenSnapshotCache.get(position.token_address) || null;
        if (!snapshot) {
          try {
            snapshot = await fetchTokenSnapshot(position.token_address);
          } catch {
            snapshot = null;
          }
        }
        const tonPriceFallback =
          snapshot?.tonPriceUsd ?? (await ensureTonPriceUsd());
        return { position, snapshot, tonPriceFallback };
      })
    );

    const header = filter === 'hidden' ? '📁 Скрытые позиции' : '💼 Твои позиции';
    const emptyText =
      filter === 'hidden'
        ? 'Скрытых позиций пока нет.'
        : 'У тебя ещё нет активных позиций. Соверши покупку через раздел «Торговля».';
    const blocks = enriched.map(({ position, snapshot, tonPriceFallback }) =>
      buildPositionBlock(position, snapshot, tonPriceFallback)
    );
    const text = [header, blocks.length ? '' : emptyText, ...blocks]
      .filter(Boolean)
      .join('\n\n');

    const keyboardRows: ReturnType<typeof Markup.inlineKeyboard>['reply_markup']['inline_keyboard'] =
      enriched.map(({ position }) => {
        const tokenKey = ensureCallbackAddressId(position.token_address);
        return [
          Markup.button.callback(
            `🚀 ${position.token_symbol || shortAddress(position.token_address)}`,
            `position_trade:${tokenKey}:${filter}`
          ),
          Markup.button.callback(
            position.is_hidden ? '👁 Показать' : '🙈 Скрыть',
            `position_toggle:${position.id}:${position.is_hidden ? 'show' : 'hide'}:${filter}`
          ),
        ];
      });
    keyboardRows.push([
      Markup.button.callback(
        filter === 'hidden' ? '📂 Активные' : '📁 Скрытые',
        `positions_view:${filter === 'hidden' ? 'active' : 'hidden'}`
      ),
    ]);
    keyboardRows.push([
      Markup.button.callback('⬅️ Меню', 'menu_home'),
      Markup.button.callback('🔁 Обновить', `positions_refresh:${filter}`),
    ]);

    return sendView(ctx, text, Markup.inlineKeyboard(keyboardRows), mode);
  } catch (err: any) {
    console.error('positions menu error:', err?.message);
    return sendView(
      ctx,
      'Не удалось загрузить позиции. Попробуй обновить позже.',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('⬅️ Меню', 'menu_home'),
          Markup.button.callback('🔁 Обновить', `positions_refresh:${filter}`),
        ],
      ]),
      mode
    );
  }
}

function buildPositionBlock(
  position: UserPositionSummary,
  snapshot: TokenSnapshot | null,
  tonPriceUsdFallback?: number
): string {
  const tokenAmount = toNumberSafe(position.amount);
  const investedTon = toNumberSafe(position.invested_ton);
  const priceTon = snapshot?.priceTon ?? null;
  const tonPriceUsd = snapshot?.tonPriceUsd ?? tonPriceUsdFallback ?? null;
  const currentValueTon =
    tokenAmount !== null && priceTon !== null ? tokenAmount * priceTon : null;
  const investedUsd =
    investedTon !== null && tonPriceUsd !== null
      ? investedTon * tonPriceUsd
      : null;
  const currentUsd =
    currentValueTon !== null && tonPriceUsd !== null
      ? currentValueTon * tonPriceUsd
      : null;
  const pnlTon =
    currentValueTon !== null && investedTon !== null
      ? currentValueTon - investedTon
      : null;
  const pnlUsd =
    pnlTon !== null && tonPriceUsd !== null ? pnlTon * tonPriceUsd : null;
  const pnlPercent =
    investedTon && investedTon > 0 && currentValueTon !== null
      ? ((currentValueTon - investedTon) / investedTon) * 100
      : null;

  const label =
    snapshot?.symbol ||
    position.token_symbol ||
    snapshot?.name ||
    position.token_name ||
    shortAddress(position.token_address);
  const trend = trendEmoji(pnlTon);

  const lines = [
    `${trend} <b>${label}</b> ${formatPercentText(pnlPercent)}`,
    `├ 🪙 Кол-во: ${formatTokenAmountText(tokenAmount)}`,
    `├ 📥 Изначальная: ${formatTonValueText(investedTon)} TON${formatUsdSuffix(
      investedUsd
    )}`,
    `├ 💰 Текущая: ${formatTonValueText(
      currentValueTon
    )} TON${formatUsdSuffix(currentUsd)}`,
    `├ 📊 PnL: ${formatTonValueText(pnlTon)} TON${formatUsdSuffix(pnlUsd)}`,
    `├ 🏦 FDV: ${formatUsdCompact(snapshot?.fdvUsd)} • 💧 LP: ${formatUsdCompact(
      snapshot?.liquidityUsd
    )}`,
    `├ 🪙 Цена: ${formatTonValueText(priceTon)} TON (${formatUsdValueText(
      snapshot?.priceUsd
    )})`,
    `├ ⏳ Продолжительность: ${formatHoldingDuration(position.created_at)}`,
    `└ 👛 Кошелёк: ${shortAddress(position.wallet_address)}`,
  ];
  return lines.join('\n');
}

function toNumberSafe(value?: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : null;
}

function formatTokenAmountText(value?: number | null): string {
  if (value === null || value === undefined) return 'н/д';
  if (Math.abs(value) >= 1) {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  }
  return value.toFixed(6);
}

function formatTonValueText(value?: number | null): string {
  if (value === null || value === undefined) return 'н/д';
  if (Math.abs(value) >= 1) {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  }
  return value.toFixed(4);
}

function formatUsdValueText(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'н/д';
  if (Math.abs(value) >= 1) {
    return `$${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(4)}`;
}

const usdCompactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

function formatUsdCompact(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'н/д';
  return `$${usdCompactFormatter.format(value)}`;
}

function formatUsdSuffix(value?: number | null): string {
  const text = formatUsdValueText(value);
  return text === 'н/д' ? '' : ` (${text})`;
}

function formatPercentText(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'н/д';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function trendEmoji(value?: number | null): string {
  if (value === null || value === undefined) return '⚪️';
  if (value > 0) return '📈';
  if (value < 0) return '📉';
  return '⚪️';
}

function formatHoldingDuration(startIso: string): string {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return 'н/д';
  let diff = Date.now() - start;
  const units: Array<{ label: string; ms: number }> = [
    { label: 'г', ms: 365 * 24 * 3600 * 1000 },
    { label: 'мес', ms: 30 * 24 * 3600 * 1000 },
    { label: 'д', ms: 24 * 3600 * 1000 },
    { label: 'ч', ms: 3600 * 1000 },
    { label: 'м', ms: 60 * 1000 },
    { label: 'с', ms: 1000 },
  ];
  const parts: string[] = [];
  for (const unit of units) {
    if (diff >= unit.ms) {
      const value = Math.floor(diff / unit.ms);
      diff -= value * unit.ms;
      parts.push(`${value}${unit.label}`);
    }
    if (parts.length >= 4) break;
  }
  return parts.length ? parts.join(' ') : 'меньше 1с';
}

