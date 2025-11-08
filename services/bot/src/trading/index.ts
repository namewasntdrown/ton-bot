import type { Telegraf } from 'telegraf';
import type { InlineQueryResultArticle } from 'telegraf/typings/core/types/typegram';
import {
  buildTokenKeyboard,
  buildTokenSummary,
  fetchTokenSnapshot,
  fetchTokenSearchResults,
  formatPercent,
  formatUsd,
  normalizeJettonAddress,
  tokenSnapshotCache,
  tradingInstructionsView,
  TokenSnapshot,
  TokenSearchItem,
} from './service';
import { sendView, ViewMode } from '../utils/telegram';

const userLastToken = new Map<number, string>();

async function renderTokenSnapshot(
  ctx: any,
  snapshot: TokenSnapshot,
  mode: ViewMode = 'edit'
) {
  const keyboard = buildTokenKeyboard(snapshot.address, snapshot);
  const extra = {
    ...(keyboard as any),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  return sendView(ctx, buildTokenSummary(snapshot), extra, mode);
}

async function showTokenByAddress(
  ctx: any,
  address: string,
  mode: ViewMode = 'reply',
  force = false
) {
  const tokenAddress = normalizeJettonAddress(address);
  if (!tokenAddress) {
    throw new Error('Это не похоже на адрес Jetton смарт-контракта.');
  }
  const snapshot = await fetchTokenSnapshot(tokenAddress, force);
  if (ctx.from?.id) {
    userLastToken.set(ctx.from.id, tokenAddress);
  }
  return renderTokenSnapshot(ctx, snapshot, mode);
}

export async function renderTradingMenu(
  ctx: any,
  mode: ViewMode = 'edit'
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId) {
    const lastAddress = userLastToken.get(userId);
    if (lastAddress) {
      try {
        const snapshot = await fetchTokenSnapshot(lastAddress);
        await renderTokenSnapshot(ctx, snapshot, mode);
        return;
      } catch (err: any) {
        console.warn('Не удалось обновить последний токен:', err?.message);
      }
    }
  }
  const instructions = tradingInstructionsView();
  await sendView(ctx, instructions.text, instructions.keyboard, mode);
}

export async function handleTokenTextMessage(
  ctx: any,
  text?: string
): Promise<boolean> {
  const normalized = text ? normalizeJettonAddress(text) : null;
  if (!normalized) return false;
  await ctx.replyWithChatAction('typing');
  const loading = await ctx
    .reply('⏳ Загружаю данные токена...', { disable_notification: true })
    .catch(() => null);
  try {
    await showTokenByAddress(ctx, normalized, 'reply', true);
  } catch (err: any) {
    await ctx.reply(
      `Не удалось получить данные о токене: ${err?.message || 'ошибка'}`,
      { disable_web_page_preview: true } as any
    );
  } finally {
    if (loading) {
      ctx.telegram.deleteMessage(loading.chat.id, loading.message_id).catch(
        () => {}
      );
    }
  }
  return true;
}

function buildInlineDescription(token: TokenSearchItem) {
  return [
    `FDV ${formatUsd(token.fdvUsd)}`,
    `LP ${formatUsd(token.liquidityUsd)}`,
    `VOL ${formatUsd(token.volume24hUsd)}`,
    `24h ${formatPercent(token.priceChange24hPct)}`,
  ].join(' · ');
}

function buildInlineResults(
  tokens: TokenSearchItem[]
): InlineQueryResultArticle[] {
  return tokens.map((token, idx) => ({
    type: 'article',
    id: `${token.address}-${idx}`,
    title: `${token.name}${token.symbol ? ` (${token.symbol})` : ''}`,
    description: buildInlineDescription(token),
    thumb_url: token.image,
    input_message_content: {
      message_text: token.address,
    },
  }));
}

export function registerTradingActions(bot: Telegraf<any>) {
  bot.action(/^token_refresh:(.+)$/, async (ctx) => {
    const address = (ctx.match as RegExpMatchArray)[1];
    try {
      await showTokenByAddress(ctx, address, 'edit', true);
      await ctx.answerCbQuery('Обновлено');
    } catch (err: any) {
      await ctx.answerCbQuery('Не удалось обновить');
    }
  });

  bot.action(/^token_share:(.+)$/, async (ctx) => {
    const address = (ctx.match as RegExpMatchArray)[1];
    const snapshot = tokenSnapshotCache.get(address);
    if (!snapshot) {
      await ctx.answerCbQuery('Сначала обнови токен');
      return;
    }
    await ctx.answerCbQuery('Скопируй сообщение 📋');
    await ctx.reply(buildTokenSummary(snapshot), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    } as any);
  });

  bot.action(/^token_buy:(.+)$/, async (ctx) => {
    const address = (ctx.match as RegExpMatchArray)[1];
    await ctx.answerCbQuery('Открываю STON.fi');
    await ctx.reply(
      `Купить: https://app.ston.fi/swap?ft=TON&tt=${address}\nАльтернатива: https://dedust.io/swap/TON/${address}`,
      { disable_web_page_preview: true } as any
    );
  });

  bot.action(/^token_sell:(.+)$/, async (ctx) => {
    const address = (ctx.match as RegExpMatchArray)[1];
    await ctx.answerCbQuery('Продажа через STON.fi / DeDust.io');
    await ctx.reply(
      `Продать: https://app.ston.fi/swap?ft=${address}&tt=TON\nDeDust: https://dedust.io/swap/${address}/TON`,
      { disable_web_page_preview: true } as any
    );
  });

  bot.action(/^token_amt:([^:]+):([^:]+)$/, async (ctx) => {
    const address = (ctx.match as RegExpMatchArray)[1];
    const amount = Number((ctx.match as RegExpMatchArray)[2]);
    const snapshot = tokenSnapshotCache.get(address);
    const approx =
      snapshot?.tonPriceUsd && Number.isFinite(amount)
        ? ` ≈ $${(amount * snapshot.tonPriceUsd).toFixed(2)}`
        : '';
    await ctx.answerCbQuery(`Выбрано ${amount} TON${approx}`);
  });

  bot.action(/^token_limit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Лимитные ордера в разработке');
  });

  bot.action(/^token_custom:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery(
      'Введи сумму TON сообщением — мы сохраним запрос для будущих сделок'
    );
  });

  bot.action(/^token_hide:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {}
  });

  const INLINE_PAGE_SIZE = 20;

  bot.on('inline_query', async (ctx) => {
    try {
      const query = ctx.inlineQuery.query?.trim() || '';
      const offset = Number(ctx.inlineQuery.offset || '0');
      const tokens = await fetchTokenSearchResults(query);
      const page = tokens.slice(offset, offset + INLINE_PAGE_SIZE);
      const results = buildInlineResults(page);
      const nextOffset =
        offset + INLINE_PAGE_SIZE < tokens.length
          ? String(offset + INLINE_PAGE_SIZE)
          : '';
      await ctx.answerInlineQuery(results, {
        cache_time: query ? 5 : 30,
        is_personal: true,
        next_offset: nextOffset,
        button:
          !results.length && !query
            ? {
                text: 'Нет токенов',
                start_parameter: 'token_search',
              }
            : undefined,
      });
    } catch (err: any) {
      console.warn('inline token search failed:', err?.message);
      await ctx.answerInlineQuery([], {
        cache_time: 2,
        is_personal: true,
        button: {
          text: 'Поиск недоступен',
          start_parameter: 'token_search_error',
        },
      });
    }
  });
}
