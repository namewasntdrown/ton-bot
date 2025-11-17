import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { sendView, ViewMode } from './utils/telegram';
import {
  handleTokenTextMessage,
  registerTradingActions,
  renderTradingMenu,
  cancelTradingInput,
} from './trading';
import { renderPositionsMenu, registerPositionActions } from './features/positions';
import {
  renderCopytradeMenu,
  registerCopytradeActions,
  handleCopytradeTextInput,
  cancelCopytradeInput,
} from './features/copytrade';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN отсутствует в services/bot/.env');
  process.exit(1);
}

const WALLET_API = process.env.WALLET_API ?? 'http://127.0.0.1:8090';

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
  } catch (err: any) {
    console.warn(`[telegram] ${label || method} warn:`, err?.response?.data || err?.message);
    return false;
  }
}

function isGetUpdatesConflict(err: any): boolean {
  const description =
    err?.response?.data?.description || err?.description || err?.message || '';
  return typeof description === 'string' && description.includes('terminated by other getUpdates request');
}

async function resetTelegramPollingSession() {
  console.warn(
    '[telegram] Detected another active getUpdates session. Trying to close it via Telegram API...'
  );
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
  let walletsLabel = '💼 Кошельки';
  if (userId) {
    try {
      const wallets = await fetchWalletsWithBalance(userId);
      const total = wallets.reduce(
        (sum, w) => sum + toNanoBigInt(w.balance_nton ?? w.balance ?? w.balanceNton ?? 0),
        0n
      );
      walletsLabel = `💼 Кошельки [ ${formatTonFromNano(total)} TON ]`;
    } catch {
      // keep fallback label
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('торговля💱', 'menu_transfer')],
    [Markup.button.callback(walletsLabel, 'menu_wallets'), Markup.button.callback('📊 Позиции', 'menu_positions')],
    [Markup.button.callback('🤝 Копитрейдинг', 'menu_copytrade'), Markup.button.callback('🎯 Снайперы', 'menu_snipes')],
    [Markup.button.callback('📋 Лимитные ордера (beta)', 'menu_limits'), Markup.button.callback('🎁 Рефералка', 'menu_ref')],
    [Markup.button.callback('📚 Помощь', 'menu_help'), Markup.button.callback('⚙️ Настройки', 'menu_settings')],
    [Markup.button.callback('🧭 Гид по боту', 'menu_guide')],
  ]);
  const text = [
    '👋 Привет! Это TON-бот для кошельков, торговли и автоматизаций.',
    'Все основные разделы доступны через менюшку ниже.',
    '',
    'Выберите нужный пункт:',
  ].join('\n');
  return sendView(ctx, text, keyboard, mode);
}

async function renderWalletsMenu(ctx: any, mode: ViewMode = 'edit') {
  const userId = ctx.from?.id;
  if (!userId) {
    return sendView(
      ctx,
      'Не удалось определить пользователя Telegram. Попробуйте перезапустить бота.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ В главное меню', 'menu_home')]]),
      mode
    );
  }

  try {
    const wallets = await fetchWalletsWithBalance(userId);
    if (!Array.isArray(wallets) || wallets.length === 0) {
      const text = [
        '💼 У вас пока нет кошельков.',
        'Создайте первый кошелек, чтобы начать пользоваться TON-ботом.',
      ].join('\n');
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Создать кошелек', 'w_new')],
        [Markup.button.callback('⬅️ В главное меню', 'menu_home')],
      ]);
      return sendView(ctx, text, keyboard, mode);
    }

    let total = 0n;
    const rows = wallets.map((wallet) => {
      const balanceNano = toNanoBigInt(wallet.balance_nton ?? wallet.balance ?? wallet.balanceNton ?? 0);
      total += balanceNano;
      const address = String(wallet.address || '');
      const label = `${address.slice(-6) || address} · ${formatTonFromNano(balanceNano)} TON`;
      return [Markup.button.callback(label, `w_open_${wallet.id}`)];
    });
    rows.push([Markup.button.callback('➕ Создать кошелек', 'w_new')]);
    rows.push([Markup.button.callback('⬅️ В главное меню', 'menu_home')]);

    const text = [
      `💼 Баланс всех кошельков: ${formatTonFromNano(total)} TON`,
      `Количество кошельков: ${wallets.length}`,
      '',
      'Выберите кошелек, чтобы посмотреть детали.',
    ].join('\n');
    return sendView(ctx, text, Markup.inlineKeyboard(rows), mode);
  } catch {
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('⬅️ В главное меню', 'menu_home')]]);
    return sendView(
      ctx,
      'Не удалось получить список кошельков. Попробуйте позже или обновите бота командой /start.',
      keyboard,
      mode
    );
  }
}

async function removeLegacyKeyboard(ctx: any) {
  if (!ctx?.chat) return;
  try {
    const msg = await ctx.reply('Переключаюсь на новое меню…', {
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
  '💼 Кошельки',
  '📈 Терминал',
  '📊 Позиции',
  'торговля💱',
  '🤝 Копитрейдинг',
  '🎯 Снайперы',
  '📋 Лимитные ордера (beta)',
  '🎁 Рефералка',
  '📚 Помощь',
  '⚙️ Настройки',
  '🧭 Гид по боту',
]);

async function ensurePolling() {
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

bot.start(async (ctx) => {
  try {
    const alive = await pingWalletApi();
    if (!alive) {
      await ctx.reply('Сервис кошельков пока не отвечает. Попробуйте чуть позже.');
    }
  } catch (err: any) {
    console.error('wallet-api check error:', err?.response?.data || err?.message);
  }

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
      'Команды:',
      '/start — перезапуск и возврат в главное меню',
      '/menu — показать главное меню',
      '/help — подсказки по управлению ботом',
      '/cancel — отменить ввод адреса/суммы или торговый диалог',
      '',
      'Все основные действия доступны через inline-меню под сообщением.',
    ].join('\n')
  );
});

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

bot.action('menu_copytrade', async (ctx) => {
  await ctx.answerCbQuery();
  await renderCopytradeMenu(ctx);
});

registerTradingActions(bot);
registerPositionActions(bot);
registerCopytradeActions(bot);

const stubViews: Record<string, { title: string; text: string }> = {
  menu_snipes: {
    title: '🎯 Снайперы',
    text: 'Автоматический мониторинг новых токенов и мгновенный вход на старте. Ведём закрытое тестирование.',
  },
  menu_limits: {
    title: '📋 Лимитные ордера (beta)',
    text: 'Создание отложенных заявок и работа с лимитной книгой. Функция в публичной бете.',
  },
  menu_ref: {
    title: '🎁 Реферальная программа',
    text: 'Приглашайте друзей и получайте бонусы с их торговой активности. Подробности появятся совсем скоро.',
  },
  menu_help: {
    title: '📚 Помощь',
    text: 'Ответы на частые вопросы и инструкции по каждой функции бота. Если не нашли нужное — напишите нам.',
  },
  menu_settings: {
    title: '⚙️ Настройки',
    text: 'Настройка уведомлений, подключение торговых стратегий и другие параметры аккаунта. Раздел в разработке.',
  },
  menu_guide: {
    title: '🧭 Гид по боту',
    text: 'Пошаговое знакомство со всеми возможностями бота. Подходит для новичков и опытных пользователей.',
  },
};

Object.entries(stubViews).forEach(([action, view]) => {
  bot.action(action, async (ctx) => {
    await ctx.answerCbQuery();
    await sendView(
      ctx,
      `${view.title}\n\n${view.text}`,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ В главное меню', 'menu_home')]])
    );
  });
});

bot.action('noop', async (ctx) => {
  await ctx.answerCbQuery('Скоро');
});

bot.action('w_new', async (ctx) => {
  try {
    const userId = ctx.from!.id;
    const response = await axios
      .post(
        `${WALLET_API}/wallets`,
        { user_id: userId },
        { timeout: 15_000, validateStatus: () => true }
      )
      .catch((err) => err?.response);

    if (response?.status === 400 && response.data?.error === 'limit') {
      return ctx.answerCbQuery('Можно создать максимум 3 кошелька на пользователя.');
    }
    if (!response || response.status >= 400) {
      return ctx.answerCbQuery('Не удалось создать кошелек. Попробуйте еще раз.');
    }

    await ctx.answerCbQuery('Готово');
    await ctx.reply(`Кошелек создан:\n<code>${response.data.address}</code>`, { parse_mode: 'HTML' });
    await renderWalletsMenu(ctx);
  } catch {
    await ctx.answerCbQuery('Не удалось создать кошелек');
  }
});

bot.action(/^w_open_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const id = Number((ctx.match as RegExpMatchArray)[1]);
    const { data: wallet } = await axios.get(`${WALLET_API}/wallets/${id}`, { timeout: 10_000 });
    let balance = '0';
    try {
      const { data } = await axios.get(`${WALLET_API}/wallets/${id}/balance`, { timeout: 10_000 });
      balance = data?.balance ?? '0';
    } catch {
      // ignore balance error
    }
    let maxSendableTon = '';
    try {
      const { data } = await axios.get(`${WALLET_API}/wallets/${id}/max_sendable`, { timeout: 10_000 });
      if (data?.max_ton) maxSendableTon = String(data.max_ton);
    } catch {
      // ignore
    }

    const ton = (Number(balance) / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 9 });
    const parts = [
      `Адрес: <code>${wallet.address}</code>`,
      `Баланс: ${ton} TON`,
    ];
    if (maxSendableTon) {
      parts.push(`Доступно для отправки (с учетом комиссий): ${maxSendableTon} TON`);
    }

    await ctx.editMessageText(parts.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🚀 Отправить TON', `w_send_${id}`),
          Markup.button.callback('📄 Список кошельков', 'w_export_all'),
        ],
        [
          Markup.button.callback('Пополнить (скоро)', 'noop'),
          Markup.button.callback('🪪 Seed/ключи', `w_seed_${id}`),
        ],
        [
          Markup.button.callback('🗑 Удалить кошелек', `w_delete_${id}`),
          Markup.button.callback('⬅️ Назад', 'w_back'),
        ],
      ]),
    });
  } catch {
    await ctx.answerCbQuery('Не удалось показать кошелек');
  }
});

bot.action('w_back', async (ctx) => {
  await ctx.answerCbQuery();
  await renderWalletsMenu(ctx);
});

bot.action(/^w_delete_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = Number((ctx.match as RegExpMatchArray)[1]);
  await ctx.reply(
    'Вы действительно хотите удалить этот кошелек? Восстановить его будет невозможно.',
    Markup.inlineKeyboard([
      [Markup.button.callback('Да, удалить', `w_delete_confirm_${id}`)],
      [Markup.button.callback('Отмена', `w_open_${id}`)],
    ])
  );
});

bot.action(/^w_delete_confirm_(\d+)$/, async (ctx) => {
  const id = Number((ctx.match as RegExpMatchArray)[1]);
  try {
    const res = await axios.delete(`${WALLET_API}/wallets/${id}`, {
      data: { user_id: ctx.from!.id },
      timeout: 10_000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      if (res.status === 404) {
        await ctx.answerCbQuery('Кошелек уже удален или не найден');
      } else {
        await ctx.answerCbQuery('Не удалось удалить кошелек');
      }
      return;
    }
    await ctx.answerCbQuery('Удалено');
    await ctx.reply('Кошелек удален.');
    await renderWalletsMenu(ctx, 'reply');
  } catch {
    await ctx.answerCbQuery('Не удалось удалить кошелек');
  }
});

type TransferState = { stage: 'to' | 'amount'; walletId: number; to?: string };
const transferState = new Map<number, TransferState>();

bot.action(/^w_send_(\d+)$/, async (ctx) => {
  const walletId = Number((ctx.match as RegExpMatchArray)[1]);
  const fromId = ctx.from?.id;
  if (!fromId) {
    await ctx.answerCbQuery('Не удалось определить пользователя');
    return;
  }
  transferState.set(fromId, { stage: 'to', walletId });
  await ctx.answerCbQuery();
  await ctx.reply('Введите TON-адрес получателя:');
});

bot.command('cancel', async (ctx) => {
  if (ctx.from?.id) {
    transferState.delete(ctx.from.id);
    cancelCopytradeInput(ctx.from.id);
    await cancelTradingInput(ctx.from.id, ctx.telegram);
  }
  await ctx.reply('Ввод отменён.');
});

bot.on('text', async (ctx, next) => {
  const text = ctx.message?.text?.trim();
  const fromId = ctx.from?.id;
  if (!fromId) {
    return next();
  }
  if (await handleCopytradeTextInput(ctx, text)) {
    return;
  }
  const state = transferState.get(fromId);
  if (!state) {
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

  if (state.stage === 'to') {
    const to = ctx.message.text.trim();
    if (to.length < 10) {
      return ctx.reply('Похоже, адрес слишком короткий. Попробуйте снова или отмените ввод через /cancel.');
    }
    transferState.set(fromId, { stage: 'amount', walletId: state.walletId, to });
    return ctx.reply('Введите сумму TON (минимум 0.5):');
  }

  if (state.stage === 'amount') {
    const amountStr = ctx.message.text.trim().replace(',', '.');
    const amount = Number(amountStr);
    if (!isFinite(amount) || amount <= 0) {
      return ctx.reply('Неверная сумма. Введите число больше 0 или отмените ввод командой /cancel.');
    }
    try {
      const response = await axios.post(
        `${WALLET_API}/transfer`,
        { user_id: fromId, wallet_id: state.walletId, to: state.to, amount_ton: amount },
        { timeout: 25_000, validateStatus: () => true }
      );
      if (response.status >= 400) {
        const code = (response.data && (response.data.error || response.data.code)) || '';
        if (code === 'bad_to') {
          return ctx.reply('Адрес получателя не прошел проверку. Проверьте корректность и попробуйте снова.');
        }
        if (code === 'insufficient') {
          return ctx.reply('Недостаточно TON на кошельке. Попробуйте уменьшить сумму.');
        }
        if (code === 'not_found') {
          return ctx.reply('Кошелек не найден. Обновите список кошельков и попробуйте снова.');
        }
        return ctx.reply('Не удалось отправить перевод. Попробуйте еще раз.');
      }
      transferState.delete(fromId);
      return ctx.reply('Перевод запущен. Как только транзакция попадет в блокчейн, вы увидите её в истории.');
    } catch {
      return ctx.reply('Сервис перевода временно недоступен. Попробуйте чуть позже.');
    }
  }
});

bot.action('w_export_all', async (ctx) => {
  try {
    const userId = ctx.from!.id;
    const { data: wallets } = await axios.get(`${WALLET_API}/wallets`, {
      params: { user_id: userId },
      timeout: 10_000,
    });
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await ctx.answerCbQuery('Кошельков нет');
      return;
    }
    const list = wallets.map((w: any, i: number) => `${i + 1}. ${w.address}`).join('\n');
    await ctx.reply(`Ваши кошельки:\n${list}`);
    await ctx.answerCbQuery();
  } catch {
    await ctx.answerCbQuery('Не удалось получить список');
  }
});

bot.action(/^w_seed_(\d+)$/, async (ctx) => {
  const id = Number((ctx.match as RegExpMatchArray)[1]);
  await ctx.editMessageText(
    [
      '⚠️ Никому не передавайте seed-фразу и приватный ключ.',
      'Если вы уверены, что хотите их посмотреть, подтвердите действие ниже.',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('Показать сид-фразу', `w_seed_show_${id}`)],
      [Markup.button.callback('⬅️ Назад', `w_open_${id}`)],
    ])
  );
});

bot.action(/^w_seed_show_(\d+)$/, async (ctx) => {
  const id = Number((ctx.match as RegExpMatchArray)[1]);
  try {
    const { data } = await axios.post(
      `${WALLET_API}/wallets/${id}/seed`,
      { user_id: ctx.from!.id, confirm: true },
      { timeout: 15_000 }
    );
    const words: string = data?.mnemonic || '';
    if (!words) {
      await ctx.answerCbQuery('Не удалось получить сид-фразу');
      return;
    }
    const msg = await ctx.reply(
      `Seed-фраза (будет удалена через 30 секунд):\n<code>${words}</code>`,
      { parse_mode: 'HTML' }
    );
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id);
      } catch {
        // ignore
      }
    }, 30_000);
    await ctx.answerCbQuery();
  } catch {
    await ctx.answerCbQuery('Не удалось получить сид-фразу');
  }
});

async function configureBotMenu() {
  const commands = [
    { command: 'start', description: 'Сбросить диалог и открыть главное меню' },
    { command: 'menu', description: 'Показать главное меню' },
    { command: 'help', description: 'Справка по боту' },
    { command: 'cancel', description: 'Отменить ввод адреса/суммы' },
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
    console.warn(
      'Telegram returned 409 (another getUpdates session). Retrying after calling close()...'
    );
  }

  await resetTelegramPollingSession();
  await ensurePolling();
  try {
    await bot.launch();
    console.log('Bot started after resetting polling session');
  } catch (retryErr: any) {
    if (isGetUpdatesConflict(retryErr)) {
      throw new Error(
        'Telegram rejected polling because another bot instance is still running. Stop the other process or use a different BOT_TOKEN.'
      );
    }
    throw retryErr;
  }
}

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
