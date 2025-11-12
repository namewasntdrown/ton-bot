import { Markup, type Telegraf } from 'telegraf';
import type { InlineQueryResultArticle } from 'telegraf/typings/core/types/typegram';
import {
  buildTokenKeyboard,
  buildTokenSummary,
  fetchTokenSnapshot,
  fetchTokenSearchResults,
  fetchTradingProfileContext,
  fetchWalletJettonBalance,
  formatPercent,
  formatUsd,
  normalizeJettonAddress,
  shortAddress,
  walletBalanceTon,
  tokenSnapshotCache,
  tradingInstructionsView,
  TokenSnapshot,
  TokenSearchItem,
  TradingContext,
  updateTradingProfile,
  submitSwapOrder,
  SwapOrderRequest,
  TradingProfile,
  WalletSummary,
} from './service';
import { sendView, ViewMode } from '../utils/telegram';

const userLastToken = new Map<number, string>();

type TradingPromptKind = 'ton_amount' | 'sell_percent' | 'limit_price';
type TradingPromptState = {
  kind: TradingPromptKind;
  mode: 'buy' | 'sell';
  address: string;
  chatId: number;
  messageId: number;
  promptChatId?: number;
  promptMessageId?: number;
};

const tradingInputState = new Map<number, TradingPromptState>();
const callbackIdToAddress = new Map<string, string>();
const addressToCallbackId = new Map<string, string>();
const walletMenuTargets = new Map<number, { chatId: number; messageId: number }>();
let callbackSeq = 0;

export function ensureCallbackAddressId(address: string): string {
  let id = addressToCallbackId.get(address);
  if (id) return id;
  id = (callbackSeq++).toString(36);
  addressToCallbackId.set(address, id);
  callbackIdToAddress.set(id, address);
  return id;
}

export function resolveCallbackAddress(id: string): string | null {
  if (!id) return null;
  if (/^(?:EQ|UQ)/.test(id)) return id;
  return callbackIdToAddress.get(id) || null;
}

function requireCallbackAddress(id: string): string | null {
  const address = resolveCallbackAddress(id);
  return address || null;
}

function formatInputNumber(value?: number | null): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (Math.abs(value) >= 1) {
    return Number(value.toFixed(2)).toString();
  }
  return Number(value.toFixed(4)).toString();
}

function resolveActiveWallet(
  profile: TradingProfile | null,
  wallets: WalletSummary[]
): WalletSummary | null {
  if (!wallets?.length) return null;
  if (profile?.active_wallet_id) {
    const matched = wallets.find((w) => w.id === profile.active_wallet_id);
    if (matched) return matched;
  }
  return wallets[0] || null;
}

type TradingCaptionExtras = {
  sellJettonBalanceLabel?: string | null;
};

function extendCaptionWithTrading(
  caption: string,
  context: TradingContext | null,
  extras: TradingCaptionExtras = {}
): string {
  if (!context) return caption;
  const lines: string[] = [];
  const wallet = resolveActiveWallet(context.profile ?? null, context.wallets);
  if (wallet) {
    lines.push(`👛 Кошелёк: <code>${shortAddress(wallet.address)}</code>`);
    lines.push(`💰 Баланс: ${walletBalanceTon(wallet)} TON`);
  } else if (!context.wallets.length) {
    lines.push('👛 Кошелёк: не найден. Создай его в разделе «Кошельки».');
  }
  const profile = context.profile;
  if (profile) {
    const mode = profile.trade_mode === 'sell' ? 'sell' : 'buy';
    lines.push(`🎯 Режим: ${mode === 'buy' ? 'Покупка' : 'Продажа'}`);
    if (mode === 'buy') {
      const tonLabel = formatInputNumber(profile.ton_amount);
      lines.push(`💎 Сумма TON: ${tonLabel ? `${tonLabel} TON` : 'не выбрана'}`);
      if (profile.buy_limit_price) {
        const limitLabel = formatInputNumber(profile.buy_limit_price);
        lines.push(`🎯 Лимит: ${limitLabel ? `${limitLabel} TON` : 'не задан'}`);
      }
    } else {
      const percentLabel = formatInputNumber(profile.sell_percent);
      lines.push(`📉 Объём продажи: ${percentLabel ? `${percentLabel}%` : 'не выбран'}`);
      if (extras.sellJettonBalanceLabel) {
        lines.push(`💵 Баланс монеты: ${extras.sellJettonBalanceLabel}`);
      }
    }
  }
  if (!lines.length) return caption;
  return `${caption}\n\n${lines.join('\n')}`;
}

async function clearTradingPrompt(
  userId: number,
  telegram?: Telegraf<any>['telegram']
): Promise<boolean> {
  const state = tradingInputState.get(userId);
  if (!state) return false;
  tradingInputState.delete(userId);
  if (telegram && state.promptChatId && state.promptMessageId) {
    await telegram.deleteMessage(state.promptChatId, state.promptMessageId).catch(() => {});
  }
  return true;
}

function storeTradingPrompt(
  userId: number,
  state: TradingPromptState
) {
  tradingInputState.set(userId, state);
}

function updatePromptMessageReference(
  userId: number,
  prompt: { chat: { id: number }; message_id: number }
) {
  const state = tradingInputState.get(userId);
  if (!state) return;
  tradingInputState.set(userId, {
    ...state,
    promptChatId: prompt.chat.id,
    promptMessageId: prompt.message_id,
  });
}

async function handleTradingInputMessage(
  ctx: any,
  text?: string | null
): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  const state = tradingInputState.get(userId);
  if (!state) return false;
  const messageText = (text ?? ctx.message?.text ?? '').trim().replace(',', '.');
  if (!messageText) {
    await ctx.reply('Введи число или нажми «Отмена».');
    return true;
  }
  const value = Number(messageText);
  if (!Number.isFinite(value) || value <= 0) {
    await ctx.reply('Некорректное значение. Используй число больше нуля или нажми «Отмена».');
    return true;
  }
  if (state.kind === 'sell_percent' && value > 100) {
    await ctx.reply('Процент продажи должен быть в диапазоне 1–100%.');
    return true;
  }
  const patch: Partial<TradingProfile> = { last_token: state.address, trade_mode: state.mode };
  if (state.kind === 'ton_amount') {
    patch.ton_amount = value;
  } else if (state.kind === 'sell_percent') {
    patch.sell_percent = value;
  } else if (state.kind === 'limit_price') {
    patch.buy_limit_price = value;
  }
  try {
    userLastToken.set(userId, state.address);
    await updateTradingProfile(userId, patch);
    const [snapshot, tradingContext] = await Promise.all([
      fetchTokenSnapshot(state.address),
      fetchTradingProfileContext(userId),
    ]);
    await renderTokenSnapshot(ctx, snapshot, 'edit', {
      tradingContext,
      targetMessage: { chatId: state.chatId, messageId: state.messageId },
    });
    await clearTradingPrompt(userId, ctx.telegram);
    await ctx.reply('Значение сохранено ✅').catch(() => {});
  } catch (err: any) {
    await ctx.reply(
      `Не удалось сохранить: ${err?.message || 'ошибка'}. Попробуй позже или /cancel.`
    );
  }
  return true;
}

async function refreshTokenCardFromCallback(
  ctx: any,
  tokenKey: string,
  force = false,
  targetOverride?: { chatId: number; messageId: number } | null
) {
  const address = resolveCallbackAddress(tokenKey);
  if (!address) {
    await ctx.answerCbQuery?.('Токен недоступен. Открой заново через поиск.');
    return false;
  }
  const [snapshot, tradingContext] = await Promise.all([
    fetchTokenSnapshot(address, force),
    ctx.from?.id ? fetchTradingProfileContext(ctx.from.id) : Promise.resolve(null),
  ]);
  await renderTokenSnapshot(ctx, snapshot, 'edit', {
    tradingContext,
    targetMessage: targetOverride || undefined,
  });
  return true;
}

type RenderOptions = {
  tradingContext?: TradingContext | null;
  targetMessage?: { chatId: number; messageId: number } | null;
};

async function renderTokenSnapshot(
  ctx: any,
  snapshot: TokenSnapshot,
  mode: ViewMode = 'edit',
  options?: RenderOptions
) {
  let tradingContext = options?.tradingContext || null;
  if (!tradingContext && ctx.from?.id) {
    try {
      tradingContext = await fetchTradingProfileContext(ctx.from.id);
    } catch {
      tradingContext = null;
    }
  }
  const activeWallet = tradingContext
    ? resolveActiveWallet(tradingContext.profile ?? null, tradingContext.wallets)
    : null;
  let sellJettonBalanceLabel: string | null = null;
  if (
    tradingContext?.profile?.trade_mode === 'sell' &&
    activeWallet?.id &&
    snapshot.address
  ) {
    try {
      const balance = await fetchWalletJettonBalance(activeWallet.id, snapshot.address);
      if (balance?.balance !== undefined && balance?.balance !== null) {
        const safeSymbol = snapshot.symbol
          ? snapshot.symbol.replace(/[<>&]/g, (char) =>
              char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&amp;'
            )
          : '';
        const suffix = safeSymbol ? ` ${safeSymbol}` : '';
        sellJettonBalanceLabel = `${balance.balance}${suffix}`;
      }
    } catch (err: any) {
      console.warn(
        'jetton balance fetch failed:',
        err?.response?.data || err?.message || err
      );
    }
  }
  const callbackId = ensureCallbackAddressId(snapshot.address);
  const keyboard = buildTokenKeyboard(snapshot.address, snapshot, tradingContext || undefined, {
    callbackId,
  });
  const keyboardPayload = keyboard as any;
  const replyMarkup = keyboardPayload.reply_markup
    ? { reply_markup: keyboardPayload.reply_markup }
    : keyboardPayload;
  const caption = extendCaptionWithTrading(
    buildTokenSummary(snapshot),
    tradingContext || null,
    { sellJettonBalanceLabel }
  );
  const target = options?.targetMessage || null;

  if (snapshot.chartImage) {
    const mediaPayload = {
      type: 'photo',
      media: { source: snapshot.chartImage, filename: 'chart.png' },
      caption,
      parse_mode: 'HTML',
    } as const;
    if (mode === 'reply' && !target) {
      return ctx.replyWithPhoto(
        { source: snapshot.chartImage, filename: 'chart.png' },
        {
          caption,
          parse_mode: 'HTML',
          ...keyboardPayload,
        }
      );
    }
    try {
      if (target) {
        return await ctx.telegram.editMessageMedia(
          target.chatId,
          target.messageId,
          undefined,
          mediaPayload as any,
          replyMarkup
        );
      }
      return await ctx.editMessageMedia(mediaPayload as any, replyMarkup);
    } catch (err: any) {
      const desc = String(err?.description || err?.message || '');
      if (desc.includes('message is not modified')) return;
      if (
        desc.includes('message to edit not found') ||
        desc.includes('message identifier not specified')
      ) {
        return ctx.replyWithPhoto(
          { source: snapshot.chartImage, filename: 'chart.png' },
          {
            caption,
            parse_mode: 'HTML',
            ...keyboardPayload,
          }
        );
      }
      throw err;
    }
  }

  const extra = {
    ...keyboardPayload,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (target) {
    try {
      return await ctx.telegram.editMessageText(
        target.chatId,
        target.messageId,
        undefined,
        caption,
        extra
      );
    } catch (err: any) {
      const desc = String(err?.description || err?.message || '');
      if (desc.includes('message is not modified')) return;
      if (
        desc.includes('message to edit not found') ||
        desc.includes('message identifier not specified')
      ) {
        return sendView(ctx, caption, extra, 'reply');
      }
      throw err;
    }
  }
  return sendView(ctx, caption, extra, mode);
}

export async function showTokenByAddress(
  ctx: any,
  address: string,
  mode: ViewMode = 'reply',
  force = false
) {
  const tokenAddress = normalizeJettonAddress(address);
  if (!tokenAddress) {
    throw new Error('Неверный адрес. Пришли корректный jetton или ссылку на него.');
  }
  const snapshot = await fetchTokenSnapshot(tokenAddress, force);
  if (ctx.from?.id) {
    userLastToken.set(ctx.from.id, tokenAddress);
  }
  return renderTokenSnapshot(ctx, snapshot, mode);
}

type TradingMenuOptions = {
  forceInstructions?: boolean;
};

export async function renderTradingMenu(
  ctx: any,
  mode: ViewMode = 'edit',
  options?: TradingMenuOptions
): Promise<void> {
  const userId = ctx.from?.id;
  if (!options?.forceInstructions && userId) {
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

export function cancelTradingInput(
  userId: number,
  telegram?: Telegraf<any>['telegram']
): Promise<boolean> {
  return clearTradingPrompt(userId, telegram);
}

export async function handleTokenTextMessage(
  ctx: any,
  text?: string
): Promise<boolean> {
  if (await handleTradingInputMessage(ctx, text)) {
    return true;
  }
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
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    try {
      const refreshed = await refreshTokenCardFromCallback(ctx, tokenKey, true);
      if (refreshed) {
        await ctx.answerCbQuery('Обновлено');
      }
    } catch (err: any) {
      await ctx.answerCbQuery('Не удалось обновить');
    }
  });

  bot.action(/^token_share:(.+)$/, async (ctx) => {
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен недоступен');
      return;
    }
    const snapshot = tokenSnapshotCache.get(address);
    if (!snapshot) {
      await ctx.answerCbQuery('Данные ещё не загружены');
      return;
    }
    await ctx.answerCbQuery('Скопировал описание в чат');
    await ctx.reply(buildTokenSummary(snapshot), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    } as any);
  });

  bot.action(/^token_buy:(.+)$/, async (ctx) => {
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен недоступен');
      return;
    }
    await ctx.answerCbQuery('Открываю STON.fi');
    await ctx.reply(
      `Покупка: https://app.ston.fi/swap?ft=TON&tt=${address}\nАльтернатива: https://dedust.io/swap/TON/${address}`,
      { disable_web_page_preview: true } as any
    );
  });

  bot.action(/^token_sell:(.+)$/, async (ctx) => {
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен недоступен');
      return;
    }
    await ctx.answerCbQuery('Открываю ссылки на обмен');
    await ctx.reply(
      `Продажа: https://app.ston.fi/swap?ft=${address}&tt=TON\nDeDust: https://dedust.io/swap/${address}/TON`,
      { disable_web_page_preview: true } as any
    );
  });

  bot.action(/^token_amt:([^:]+):([^:]+)$/, async (ctx) => {
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    const amount = Number((ctx.match as RegExpMatchArray)[2]);
    const address = resolveCallbackAddress(tokenKey);
    const snapshot = address ? tokenSnapshotCache.get(address) : null;
    const approx =
      snapshot?.tonPriceUsd && Number.isFinite(amount)
        ? ` ≈ $${(amount * snapshot.tonPriceUsd).toFixed(2)}`
        : '';
    await ctx.answerCbQuery(`Выбрано ${amount} TON${approx}`);
  });

  bot.action(/^token_limit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Используй кнопки «Своя сумма»/«Лимит», чтобы задать параметры');
  });

  bot.action(/^token_custom:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Новый режим уже работает в блоке торговли');
  });

  bot.action(/^token_hide:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {}
    if (ctx.from?.id) {
      userLastToken.delete(ctx.from.id);
    }
    try {
      await renderTradingMenu(ctx, 'reply', { forceInstructions: true });
    } catch (err) {
      console.error('render trading menu after hide failed', err);
    }
  });

  bot.action(/^trade_mode:([^:]+):(buy|sell)$/, async (ctx) => {
    const [, tokenKey, mode] = ctx.match as RegExpMatchArray;
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен устарел, открой его заново');
      return;
    }
    await clearTradingPrompt(ctx.from.id, ctx.telegram);
    try {
      await updateTradingProfile(ctx.from.id, {
        trade_mode: mode as 'buy' | 'sell',
        last_token: address,
      });
      await refreshTokenCardFromCallback(ctx, tokenKey);
      await ctx.answerCbQuery(mode === 'buy' ? 'Режим: покупка' : 'Режим: продажа');
    } catch {
      await ctx.answerCbQuery('Не удалось обновить режим');
    }
  });

  bot.action(/^trade_quick:([^:]+):(buy|sell):([\d.]+)$/, async (ctx) => {
    const [, tokenKey, mode, rawValue] = ctx.match as RegExpMatchArray;
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен устарел');
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      await ctx.answerCbQuery('Некорректное значение');
      return;
    }
    await clearTradingPrompt(ctx.from.id, ctx.telegram);
    const patch: Partial<TradingProfile> =
      mode === 'buy'
        ? { ton_amount: value, trade_mode: 'buy' }
        : { sell_percent: value, trade_mode: 'sell' };
    patch.last_token = address;
    try {
      await updateTradingProfile(ctx.from.id, patch);
      await refreshTokenCardFromCallback(ctx, tokenKey);
      await ctx.answerCbQuery('Сохранено');
    } catch {
      await ctx.answerCbQuery('Ошибка сохранения');
    }
  });

  bot.action(/^trade_custom_primary:([^:]+):(buy|sell)$/, async (ctx) => {
    const [, tokenKey, mode] = ctx.match as RegExpMatchArray;
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен устарел');
      return;
    }
    const message = ctx.callbackQuery?.message;
    if (!message?.chat?.id) {
      await ctx.answerCbQuery('Сообщение не найдено');
      return;
    }
    await clearTradingPrompt(ctx.from.id, ctx.telegram);
    storeTradingPrompt(ctx.from.id, {
      kind: mode === 'sell' ? 'sell_percent' : 'ton_amount',
      mode: mode as 'buy' | 'sell',
      address,
      chatId: message.chat.id,
      messageId: message.message_id,
    });
    const promptText =
      mode === 'sell'
        ? 'Введи процент jetton, который хочешь продать (1–100):'
        : 'Введи сумму TON, которую готов потратить:';
    const prompt = await ctx.reply(promptText, {
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'trade_input_cancel')]]).reply_markup,
    });
    updatePromptMessageReference(ctx.from.id, prompt);
    await ctx.answerCbQuery('Жду ввод');
  });

  bot.action(/^trade_custom_price:([^:]+)$/, async (ctx) => {
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен устарел');
      return;
    }
    const message = ctx.callbackQuery?.message;
    if (!message?.chat?.id) {
      await ctx.answerCbQuery('Сообщение не найдено');
      return;
    }
    await clearTradingPrompt(ctx.from.id, ctx.telegram);
    storeTradingPrompt(ctx.from.id, {
      kind: 'limit_price',
      mode: 'buy',
      address,
      chatId: message.chat.id,
      messageId: message.message_id,
    });
    const prompt = await ctx.reply('Введи лимитную цену (TON за 1 jetton):', {
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'trade_input_cancel')]]).reply_markup,
    });
    updatePromptMessageReference(ctx.from.id, prompt);
    await ctx.answerCbQuery('Жду ввод');
  });

  bot.action(/^trade_input_cancel(?::(.+))?$/, async (ctx) => {
    if (ctx.from?.id) {
      await clearTradingPrompt(ctx.from.id, ctx.telegram);
    }
    await ctx.answerCbQuery('Отменено');
    try {
      await ctx.deleteMessage();
    } catch {}
  });

  bot.action(/^trade_wallet_menu:(.+)$/, async (ctx) => {
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен устарел');
      return;
    }
    try {
      const context = await fetchTradingProfileContext(ctx.from.id);
      const wallets = context.wallets;
      if (!wallets.length) {
        await ctx.answerCbQuery('Нет кошельков');
        await ctx.reply('Создай кошелёк в разделе «Кошельки» и вернись в торговлю.');
        return;
      }
      if (wallets.length === 1) {
        const only = wallets[0];
        await updateTradingProfile(ctx.from.id, {
          active_wallet_id: only.id,
          last_token: address,
        });
        await refreshTokenCardFromCallback(ctx, tokenKey);
        await ctx.answerCbQuery('Единственный кошелёк выбран автоматически');
        return;
      }
      const sourceMessage = ctx.callbackQuery?.message;
      if (sourceMessage?.chat?.id && sourceMessage?.message_id) {
        walletMenuTargets.set(ctx.from.id, {
          chatId: sourceMessage.chat.id,
          messageId: sourceMessage.message_id,
        });
      }
      const callbackId = ensureCallbackAddressId(address);
      const rows = wallets.map((wallet, idx) => [
        Markup.button.callback(
          `${idx + 1}. ${shortAddress(wallet.address)} · ${walletBalanceTon(wallet)} TON`,
          `trade_wallet_pick:${callbackId}:${wallet.id}`
        ),
      ]);
      rows.push([Markup.button.callback('❌ Отмена', 'trade_wallet_cancel')]);
      await ctx.answerCbQuery('Выбери кошелёк');
      await ctx.reply('Выбери кошелёк для торговли:', {
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    } catch (err: any) {
      await ctx.answerCbQuery('Ошибка кошельков');
    }
  });

  bot.action(/^trade_wallet_pick:([^:]+):(\d+)$/, async (ctx) => {
    const [, tokenKey, idRaw] = ctx.match as RegExpMatchArray;
    const walletId = Number(idRaw);
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен устарел');
      return;
    }
    await clearTradingPrompt(ctx.from.id, ctx.telegram);
    const targetMessage = walletMenuTargets.get(ctx.from.id) || null;
    try {
      await updateTradingProfile(ctx.from.id, {
        active_wallet_id: walletId,
        last_token: address,
      });
      await refreshTokenCardFromCallback(ctx, tokenKey, false, targetMessage);
      await ctx.answerCbQuery('Кошелёк выбран');
      try {
        await ctx.deleteMessage();
      } catch {}
    } catch {
      await ctx.answerCbQuery('Не удалось выбрать кошелёк');
    } finally {
      walletMenuTargets.delete(ctx.from.id);
    }
  });

  bot.action(/^trade_wallet_cancel(?::(.+))?$/, async (ctx) => {
    await ctx.answerCbQuery('Отменено');
    if (ctx.from?.id) {
      walletMenuTargets.delete(ctx.from.id);
    }
    try {
      await ctx.deleteMessage();
    } catch {}
  });

  bot.action('trade_wallet_create', async (ctx) => {
    await ctx.answerCbQuery('Подсказка отправлена');
    await ctx.reply('Создай кошелёк в разделе «Кошельки», затем возвращайся в торговлю.');
  });

  bot.action(/^trade_swap:(.+)$/, async (ctx) => {
    const tokenKey = (ctx.match as RegExpMatchArray)[1];
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const address = resolveCallbackAddress(tokenKey);
    if (!address) {
      await ctx.answerCbQuery('Токен устарел');
      return;
    }
    try {
      const context = await fetchTradingProfileContext(ctx.from.id);
      const profile = context.profile;
      const wallet = resolveActiveWallet(profile ?? null, context.wallets);
      if (!wallet) {
        await ctx.answerCbQuery('Нет кошелька');
        await ctx.reply('Создай и выбери кошелёк в разделе «Кошельки».');
        return;
      }
      if (!profile) {
        await ctx.answerCbQuery('Нет настроек');
        await ctx.reply('Выбери сумму, режим и кошелёк перед запуском свапа.');
        return;
      }
      const direction: 'buy' | 'sell' = profile.trade_mode === 'sell' ? 'sell' : 'buy';
      const tonAmount =
        profile.ton_amount && profile.ton_amount > 0
          ? profile.ton_amount
          : direction === 'sell'
          ? 1
          : null;
      if (!tonAmount) {
        await ctx.answerCbQuery('Нужна сумма');
        await ctx.reply('Укажи сумму TON кнопками или через «Своя сумма».');
        return;
      }
      if (direction === 'sell' && (!profile.sell_percent || profile.sell_percent <= 0)) {
        await ctx.answerCbQuery('Нужен процент');
        await ctx.reply('Укажи процент продажи (% кнопки или «Свой %»).');
        return;
      }
      let snapshot: TokenSnapshot | null =
        tokenSnapshotCache.get(address) || null;
      if (!snapshot) {
        try {
          snapshot = await fetchTokenSnapshot(address);
        } catch {
          snapshot = null;
        }
      }
      const payload: SwapOrderRequest = {
        user_id: ctx.from.id,
        wallet_id: wallet.id,
        token_address: address,
        direction,
        ton_amount: tonAmount,
      };
      if (profile.buy_limit_price && profile.buy_limit_price > 0) {
        payload.limit_price = profile.buy_limit_price;
      }
      if (profile.sell_percent && profile.sell_percent > 0) {
        payload.sell_percent = profile.sell_percent;
      }
      if (
        direction === 'buy' &&
        snapshot?.priceTon &&
        snapshot.priceTon > 0
      ) {
        const tokenAmountEstimate = tonAmount / snapshot.priceTon;
        payload.position_hint = {
          token_amount: tokenAmountEstimate,
          token_price_ton: snapshot.priceTon,
          token_price_usd: snapshot.priceUsd,
          token_symbol: snapshot.symbol ?? undefined,
          token_name: snapshot.name ?? undefined,
          token_image: snapshot.image ?? undefined,
        };
      }
      const { order } = await submitSwapOrder(payload);
      await ctx.answerCbQuery('Заявка отправлена');
      await ctx.reply(
        [
          `✅ Заявка №${order.id} создана`,
          `Режим: ${direction === 'buy' ? 'Покупка' : 'Продажа'}`,
          `Кошелёк: ${shortAddress(wallet.address)}`,
          `Статус: ${order.status}`,
        ].join('\n')
      );
    } catch (err: any) {
      const code = err?.code || err?.message || '';
      let message = 'Не удалось отправить свап. Попробуй ещё раз позже.';
      if (code === 'wallet_not_found') {
        message = 'Кошелёк не найден. Создай и привяжи кошелёк.';
      }
      await ctx.answerCbQuery('Ошибка');
      await ctx.reply(message);
    }
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
        offset + INLINE_PAGE_SIZE < tokens.length ? String(offset + INLINE_PAGE_SIZE) : '';
      await ctx.answerInlineQuery(results, {
        cache_time: query ? 5 : 30,
        is_personal: true,
        next_offset: nextOffset,
        button:
          !results.length && !query
            ? {
                text: 'Открыть поиск',
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
          text: 'Ошибка, попробуй ещё раз',
          start_parameter: 'token_search_error',
        },
      });
    }
  });
}









