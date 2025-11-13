// services/bot/src/index.ts
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { sendView, ViewMode } from './utils/telegram';
import {
  handleTokenTextMessage,
  registerTradingActions,
  renderTradingMenu,
  cancelTradingInput,
  showTokenByAddress,
} from './trading';
import { renderPositionsMenu, registerPositionActions } from './features/positions';

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не задан в .env (services/bot/.env)');
  process.exit(1);
}

// Лучше 127.0.0.1, чтобы исключить странности с localhost
const WALLET_API = process.env.WALLET_API || 'http://127.0.0.1:8090';
const TON_RPC =
  process.env.TON_RPC_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';

const bot = new Telegraf(BOT_TOKEN);
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const NANO_IN_TON = 1_000_000_000n;

type TelegramApiParams = Record<string, string | number | boolean | undefined | null>;

async function callTelegramBotApi(
  method: string,
  params?: TelegramApiParams,
  label?: string,
  timeout = 7000
): Promise<boolean> {
  const query =
    params && Object.keys(params).length
      ? Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(
            ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
          )
          .join('&')
      : '';
  const url = `${TELEGRAM_API_BASE}/${method}${query ? `?${query}` : ''}`;
  try {
    await axios.get(url, { timeout });
    if (label) console.log(`[telegram] ${label}: ok`);
    return true;
  } catch (e: any) {
    console.warn(`[telegram] ${label || method} warn:`, e?.response?.data || e?.message);
    return false;
  }
}

function isGetUpdatesConflict(err: any): boolean {
  const description =
    err?.response?.data?.description || err?.description || err?.message || '';
  return typeof description === 'string' && description.includes('terminated by other getUpdates request');
}

async function resetTelegramPollingSession() {
  console.warn('[telegram] Detected another active getUpdates session. Trying to close it via Telegram API...');
  const closed = await callTelegramBotApi('close', undefined, 'close');
  if (!closed) {
    throw new Error(
      'Cannot close the previous Telegram polling session automatically. Stop other bot instances or wait a minute and try again.'
    );
  }
  await delay(1000);
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
    // ignore and fall through
  }
  return 0n;
}

function formatTonFromNano(value: unknown): string {
  let nano = toNanoBigInt(value);
  const negative = nano < 0n;
  if (negative) nano = -nano;
  const intPart = nano / NANO_IN_TON;
  let frac = (nano % NANO_IN_TON).toString().padStart(9, '0').replace(/0+$/, '');
  const base = frac ? `${intPart}.${frac}` : `${intPart}`;
  return negative ? `-${base}` : base;
}

type WalletRecord = {
  id: number;
  address: string;
  balance?: string | null;
  balance_nton?: string | null;
  balanceNton?: string | null;
};

async function fetchWalletsWithBalance(userId: number): Promise<WalletRecord[]> {
  const { data } = await axios.get(`${WALLET_API}/wallets`, {
    params: { user_id: userId, with_balance: 1 },
    timeout: 10_000,
  });
  return Array.isArray(data) ? data : [];
}

async function renderMainMenu(ctx: any, mode: ViewMode = 'edit') {
  const userId = ctx.from?.id;
  let walletsLabel = 'Кошельки 👛';
  if (userId) {
    try {
      const wallets = await fetchWalletsWithBalance(userId);
      const total = wallets.reduce(
        (sum, w) => sum + toNanoBigInt(w.balance_nton ?? w.balance ?? w.balanceNton ?? 0),
        0n
      );
      walletsLabel = `Кошельки 👛 [ ${formatTonFromNano(total)} 💎 ]`;
    } catch {
      // ignore and keep default label
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🏆 Торговый конкурс', 'menu_competition')],
    [Markup.button.callback(walletsLabel, 'menu_wallets'), Markup.button.callback('💼 Позиции', 'menu_positions')],
    [Markup.button.callback('🚀 Торговля', 'menu_transfer')],
    [Markup.button.callback('🤖 Копи-трейдинг', 'menu_copytrade'), Markup.button.callback('🎯 Снайпы', 'menu_snipes')],
    [Markup.button.callback('🧱 Лимитки [BETA]', 'menu_limits'), Markup.button.callback('🤝 Рефералка', 'menu_ref')],
    [Markup.button.callback('🆘 Помощь', 'menu_help'), Markup.button.callback('⚙️ Настройки', 'menu_settings')],
    [Markup.button.callback('📚 Руководство', 'menu_guide')],
  ]);
  const text =
    'Привет! Я помогу тебе торговать на TON быстрее всех 🚀\n\nВыбирай раздел ниже:';
  return sendView(ctx, text, keyboard, mode);
}

async function renderWalletsMenu(ctx: any, mode: ViewMode = 'edit') {
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
    const wallets = await fetchWalletsWithBalance(userId);
    if (!Array.isArray(wallets) || wallets.length === 0) {
      const text = 'Кошельки 👛 [ 0 💎 ]\nУ тебя пока нет кошельков.';
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🆕 Новый кошелёк', 'w_new')],
        [Markup.button.callback('⬅️ Меню', 'menu_home')],
      ]);
      return sendView(ctx, text, keyboard, mode);
    }

    let total = 0n;
    const rows = wallets.map((w) => {
      const balanceNano = toNanoBigInt(w.balance_nton ?? w.balance ?? w.balanceNton ?? 0);
      total += balanceNano;
      const address = String(w.address || '');
      const label = `${address.slice(-6) || address || '??????'} · 💎 ${formatTonFromNano(
        balanceNano
      )}`;
      return [Markup.button.callback(label, `w_open_${w.id}`)];
    });
    rows.push([Markup.button.callback('🆕 Новый кошелёк', 'w_new')]);
    rows.push([Markup.button.callback('⬅️ Меню', 'menu_home')]);

    const text = `Кошельки 👛 [ ${formatTonFromNano(total)} 💎 ]\nВсего кошельков: ${
      wallets.length
    }`;
    return sendView(ctx, text, Markup.inlineKeyboard(rows), mode);
  } catch (err) {
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Меню', 'menu_home')]]);
    return sendView(
      ctx,
      'Сервис кошельков недоступен. Попробуй позже.',
      keyboard,
      mode
    );
  }
}

async function removeLegacyKeyboard(ctx: any) {
  if (!ctx?.chat) return;
  try {
    const msg = await ctx.reply('Меню обновлено. Используй кнопки под сообщением 👇', {
      reply_markup: { remove_keyboard: true },
      disable_notification: true,
    });
    setTimeout(() => {
      ctx.telegram?.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }, 1500);
  } catch {
    // ignore cleanup failures
  }
}

const legacyReplyButtons = new Set([
  'Мои кошельки👛',
  '🏆 Торговый конкурс',
  '💼 Позиции',
  '💸 Перевод',
  '🚀 Торговля',
  '🤖 Копи-трейдинг',
  '🎯 Снайпы',
  '🧱 Лимитки [BETA]',
  '🤝 Рефералка',
  '🆘 Помощь',
  '⚙️ Настройки',
  '📚 Руководство',
]);

// ---------- утилиты ----------

async function ensurePolling() {

  // снимаем webhook, если вдруг включён — иначе будет 409: Conflict
  await callTelegramBotApi('deleteWebhook', { drop_pending_updates: true }, 'deleteWebhook');

}

async function pingWalletApi(): Promise<boolean> {
  try {
    const { data } = await axios.get(`${WALLET_API}/health`, { timeout: 4000 });
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

// ---------- команды ----------

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);

  // Пытаемся проверить доступность wallet-api (создание кошелька теперь через меню)
  try {
    const alive = await pingWalletApi();
    if (!alive) {
      await ctx.reply('😔 Сервис кошельков временно недоступен. Попробуй позже.');
    }
  } catch (e: any) {
    console.error('wallet-api check error:', e?.response?.data || e?.message);
  }

  // Приветствие и главное меню (inline)
  await removeLegacyKeyboard(ctx);
  await renderMainMenu(ctx, 'reply');
});

bot.command('menu', async (ctx) => {
  await removeLegacyKeyboard(ctx);
  await renderMainMenu(ctx, 'reply');
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'ℹ️ Команды:',
      '/start — запуск и получение кошелька',
      '/help — эта справка',
      '',
      'Используй кнопки под последним сообщением, чтобы управлять ботом.',
    ].join('\n')
  );
});

// ---------- inline меню ----------

bot.action('menu_home', async (ctx) => {
  await ctx.answerCbQuery();
  await renderMainMenu(ctx);
});

bot.action('menu_wallets', async (ctx) => {
  await ctx.answerCbQuery();
  await renderWalletsMenu(ctx);
});

bot.action('menu_positions', async (ctx) => {
  await ctx.answerCbQuery();
  await renderPositionsMenu(ctx);
});

bot.action('menu_transfer', async (ctx) => {
  await ctx.answerCbQuery();
  await renderTradingMenu(ctx);
});

registerTradingActions(bot);
registerPositionActions(bot);

const stubViews: Record<
  string,
  { title: string; text: string }
> = {
  menu_competition: {
    title: '🏆 Торговый конкурс',
    text: 'Скоро объявим детали конкурса и призы. Следи за новостями!'
  },
  
  menu_copytrade: {
    title: '🤖 Копи-трейдинг',
    text: 'Копитрейдинг: список трейдеров появится позже.'
  },
  menu_snipes: {
    title: '🎯 Снайпы',
    text: 'Снайпер: скоро добавим стратегию и подписку на листинги.'
  },
  menu_limits: {
    title: '🧱 Лимитки [BETA]',
    text: 'Раздел лимитных ордеров готовится к запуску.'
  },
  menu_ref: {
    title: '🤝 Рефералка',
    text: 'Программа рекомендаций скоро откроется. Приглашай друзей и получай бонусы!'
  },
  menu_help: {
    title: '🆘 Помощь',
    text: 'Возник вопрос? Напиши в поддержку — мы поможем как можно быстрее.'
  },
  menu_settings: {
    title: '⚙️ Настройки',
    text: 'Персональные настройки появятся в одном из ближайших релизов.'
  },
  menu_guide: {
    title: '📚 Руководство',
    text: 'Готовим подробное руководство по боту. Пока что следи за обновлениями.'
  },
};

Object.entries(stubViews).forEach(([action, view]) => {
  if (action === 'menu_wallets') return;
  bot.action(action, async (ctx) => {
    await ctx.answerCbQuery();
    await sendView(
      ctx,
      `${view.title}\n\n${view.text}`,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Меню', 'menu_home')]])
    );
  });
});

bot.action('noop', async (ctx) => {
  await ctx.answerCbQuery('Скоро 😊');
});

// --------------- Кошельки ---------------

bot.action('w_new', async (ctx) => {
  try {
    const userId = ctx.from!.id;
    const r = await axios
      .post(
        `${WALLET_API}/wallets`,
        { user_id: userId },
        { timeout: 15_000, validateStatus: () => true }
      )
      .catch((e) => e.response);

    if (r?.status === 400 && r.data?.error === 'limit') {
      return ctx.answerCbQuery('🚫 Максимум 3 кошелька на пользователя.');
    }
    if (!r || r.status >= 400) {
      return ctx.answerCbQuery('Ошибка сервера');
    }

    await ctx.answerCbQuery('Создан');
    await ctx.reply(`✅ Кошелёк создан:\n<code>${r.data.address}</code>`, { parse_mode: 'HTML' });
    await renderWalletsMenu(ctx);
  } catch (e: any) {
    await ctx.answerCbQuery('Ошибка сервера');
  }
});

bot.action(/^w_open_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const id = Number((ctx.match as RegExpMatchArray)[1]);
    const { data: w } = await axios.get(`${WALLET_API}/wallets/${id}`, { timeout: 10_000 });
    let balance = '0';
    try {
      const { data: b } = await axios.get(`${WALLET_API}/wallets/${id}/balance`, { timeout: 10_000 });
      balance = b?.balance ?? '0';
    } catch {}
    let maxSendableTon = '';
    try {
      const { data: mx } = await axios.get(`${WALLET_API}/wallets/${id}/max_sendable`, { timeout: 10_000 });
      if (mx?.max_ton) maxSendableTon = String(mx.max_ton);
    } catch {}
    const ton = (Number(balance) / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 9 });
    const lines = [
      `Адрес: <code>${w.address}</code>`,
      `Баланс: 💎 ${ton}`,
    ];
    if (maxSendableTon) lines.push(`Доступно к переводу: ${maxSendableTon} TON`);
    const text = lines.join('\n');

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Перевод ➡️', `w_send_${id}`), Markup.button.callback('Экспорт 🧾', 'w_export_all')],
        [Markup.button.callback('Изменить имя ✍️', 'noop'), Markup.button.callback('Сид-фраза 🌿', `w_seed_${id}`)],
        [Markup.button.callback('Удалить 🗑', 'noop'), Markup.button.callback('⬅️ Назад', 'w_back')],
      ]),
    });
  } catch (e: any) {
    await ctx.answerCbQuery('Не удалось открыть кошелёк');
  }
});

bot.action('w_back', async (ctx) => {
  await ctx.answerCbQuery();
  await renderWalletsMenu(ctx);
});

// ---- Перевод ----
type TransferState = { stage: 'to' | 'amount'; walletId: number; to?: string };
const transferState = new Map<number, TransferState>();

bot.action(/^w_send_(\d+)$/, async (ctx) => {
  const walletId = Number((ctx.match as RegExpMatchArray)[1]);
  transferState.set(ctx.from!.id, { stage: 'to', walletId });
  await ctx.answerCbQuery();
  await ctx.reply('Введи адрес получателя (TON):');
});

bot.command('cancel', async (ctx) => {
  if (ctx.from?.id) {
    transferState.delete(ctx.from.id);
    await cancelTradingInput(ctx.from.id, ctx.telegram);
  }
  await ctx.reply('Отменено.');
});

bot.on('text', async (ctx, next) => {
  const text = ctx.message?.text?.trim();
  const st = transferState.get(ctx.from.id);
  if (!st) {
    if (text && legacyReplyButtons.has(text)) {
      await removeLegacyKeyboard(ctx);
      await renderMainMenu(ctx, 'reply');
      return;
    }
    if (await handleTokenTextMessage(ctx, text)) {
      return;
    }
    return next();
  }

  if (st.stage === 'to') {
    const to = ctx.message.text.trim();
    if (to.length < 10) {
      return ctx.reply('Некорректный адрес. Введи адрес снова или /cancel');
    }
    transferState.set(ctx.from.id, { stage: 'amount', walletId: st.walletId, to });
    return ctx.reply('Введи сумму в TON (например 0.5):');
  }

  if (st.stage === 'amount') {
    const amountStr = ctx.message.text.trim().replace(',', '.');
    const amount = Number(amountStr);
    if (!isFinite(amount) || amount <= 0) {
      return ctx.reply('Некорректная сумма. Введи число больше 0 или /cancel');
    }
    try {
      const r = await axios.post(
        `${WALLET_API}/transfer`,
        { user_id: ctx.from.id, wallet_id: st.walletId, to: st.to, amount_ton: amount },
        { timeout: 25_000, validateStatus: () => true }
      );
      if (r.status >= 400) {
        const code = (r.data && (r.data.error || r.data.code)) || '';
        if (code === 'bad_to') {
          return ctx.reply('Адрес получателя некорректен. Проверь и отправь снова.');
        }
        if (code === 'insufficient') {
          return ctx.reply('Недостаточно TON с учётом комиссии. Уменьши сумму или пополни баланс.');
        }
        if (code === 'not_found') {
          return ctx.reply('Кошелёк не найден или не принадлежит тебе. Открой нужный кошелёк и попробуй снова.');
        }
        return ctx.reply('Перевод не выполнен. Проверь данные и баланс.');
      }
      transferState.delete(ctx.from.id);
      return ctx.reply('Готово. Перевод отправлен.');
    } catch (e: any) {
      return ctx.reply('Произошла ошибка при отправке. Попробуй позже.');
    }
  }
});

bot.action('w_export_all', async (ctx) => {
  try {
    const userId = ctx.from!.id;
    const { data: wallets } = await axios.get(`${WALLET_API}/wallets`, { params: { user_id: userId }, timeout: 10000 });
    if (!Array.isArray(wallets) || wallets.length === 0) return ctx.answerCbQuery('Нет кошельков');
    const list = wallets.map((w: any, i: number) => `${i + 1}. ${w.address}`).join('\n');
    await ctx.reply(`Адреса кошельков:\n${list}`);
    await ctx.answerCbQuery();
  } catch {
    await ctx.answerCbQuery('Ошибка');
  }
});

// Показ сид-фразы с подтверждением
bot.action(/^w_seed_(\d+)$/, async (ctx) => {
  const id = Number((ctx.match as RegExpMatchArray)[1]);
  await ctx.editMessageText(
    '⚠️ Сид-фраза дает полный доступ к средствам. Держи её в секрете и не делись с кем-либо. Показать сейчас?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Понимаю риск — показать', `w_seed_show_${id}`)],
      [Markup.button.callback('⬅️ Назад', `w_open_${id}`)],
    ])
  );
});

bot.action(/^w_seed_show_(\d+)$/, async (ctx) => {
  const id = Number((ctx.match as RegExpMatchArray)[1]);
  try {
    const { data } = await axios.post(`${WALLET_API}/wallets/${id}/seed`, { user_id: ctx.from!.id, confirm: true }, { timeout: 15000 });
    const words: string = data?.mnemonic || '';
    if (!words) return ctx.answerCbQuery('Ошибка');
    const msg = await ctx.reply(`🌱 Сид-фраза (удали это сообщение):\n<code>${words}</code>`, { parse_mode: 'HTML' });
    setTimeout(async () => {
      try { await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id); } catch {}
    }, 30000);
    await ctx.answerCbQuery();
  } catch {
    await ctx.answerCbQuery('Ошибка');
  }
});

// Опционально — команды в меню клиента
async function configureBotMenu() {
  const commands = [
    { command: 'start', description: 'Запуск и получение кошелька' },
    { command: 'menu', description: 'Показать главное меню' },
    { command: 'help', description: 'Помощь' },
  ];
  try {
    await bot.telegram.setMyCommands(commands);
  } catch (err: any) {
    console.warn('Failed to set bot commands:', err?.response?.data || err?.message || err);
  }
  try {
    await bot.telegram.setChatMenuButton({
      menuButton: { type: 'commands' },
    });
  } catch (err: any) {
    console.warn('Failed to set chat menu button:', err?.response?.data || err?.message || err);
  }
}

async function startBotWithSingleInstanceGuard() {
  await ensurePolling();
  try {
    await bot.launch();
    console.log('Bot started (polling)');
    return;
  } catch (err: any) {
    if (!isGetUpdatesConflict(err)) {
      throw err;
    }
    console.warn('Telegram returned 409 (another getUpdates session). Retrying after calling close()...');
  }

  await resetTelegramPollingSession();
  await ensurePolling();
  try {
    await bot.launch();
    console.log('Bot started after resetting polling session');
  } catch (retryErr: any) {
    if (isGetUpdatesConflict(retryErr)) {
      throw new Error('Telegram rejected polling because another bot instance is still running. Stop the other process or use a different BOT_TOKEN.');
    }
    throw retryErr;
  }
}

// ---------- запуск ----------

(async () => {
  try {
    await configureBotMenu();
    await startBotWithSingleInstanceGuard();
  } catch (err: any) {
    console.error('Bot failed to start:', err?.response?.data || err?.message || err);
    process.exit(1);
  }
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
