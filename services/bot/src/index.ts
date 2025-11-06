// services/bot/src/index.ts
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

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

// ---------- утилиты ----------

async function ensurePolling() {
  // снимаем webhook, если вдруг включён — иначе будет 409: Conflict
  try {
    await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`,
      { timeout: 7000 }
    );
    console.log('🔧 deleteWebhook: ok');
  } catch (e: any) {
    console.warn('deleteWebhook warn:', e?.response?.data || e?.message);
  }
}

async function pingWalletApi(): Promise<boolean> {
  try {
    const { data } = await axios.get(`${WALLET_API}/health`, { timeout: 4000 });
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

// ---------- меню ----------

const mainMenu = Markup.keyboard([
  [Markup.button.text('💼 Мой кошелёк')],
  [Markup.button.text('🏆 Торговый конкурс'), Markup.button.text('💼 Позиции')],
  [Markup.button.text('💸 Перевод'), Markup.button.text('🔎 Поиск токенов')],
  [Markup.button.text('🤖 Копи-трейдинг'), Markup.button.text('🎯 Снайпы')],
  [Markup.button.text('🧱 Лимитки [BETA]'), Markup.button.text('🤝 Рефералка')],
  [Markup.button.text('🆘 Помощь'), Markup.button.text('⚙️ Настройки')],
  [Markup.button.text('📚 Руководство'), Markup.button.text('💰 Баланс')],
]).resize();

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

  // Приветствие и меню (всегда показываем)
  await ctx.reply('Привет! Я помогу тебе торговать на TON быстрее всех 🚀', mainMenu);
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'ℹ️ Команды:',
      '/start — запуск и получение кошелька',
      '/help — эта справка',
      '',
      'Меню внизу экрана содержит быстрые действия.',
    ].join('\n')
  );
});

bot.hears('💰 Баланс', async (ctx) => {
  // демо-адрес, просто проверка RPC
  const testAddress = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
  try {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getAddressInformation',
      params: { address: testAddress },
    };
    const { data } = await axios.post(TON_RPC, payload, { timeout: 10_000 });
    const balance = data?.result?.balance ? Number(data.result.balance) / 1e9 : 0;
    await ctx.reply(
      `Баланс адреса (демо): ${balance} TON\n\nRaw: ${JSON.stringify(data.result ?? data)}`
    );
  } catch (e: any) {
    await ctx.reply(`Не смог получить баланс от RPC: ${e.message}`);
  }
});

bot.hears('🎯 Снайпы', (ctx) =>
  ctx.reply('Снайпер: скоро добавим стратегию и подписку на листинги.')
);
bot.hears('🤖 Копи-трейдинг', (ctx) =>
  ctx.reply('Копитрейдинг: список трейдеров появится позже.')
);

// --------------- Кошельки ---------------

bot.hears('💼 Мой кошелёк', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const { data: wallets } = await axios.get(`${WALLET_API}/wallets`, {
      params: { user_id: userId },
      timeout: 10_000,
    });

    if (!Array.isArray(wallets) || wallets.length === 0) {
      return ctx.reply(
        'У тебя пока нет кошельков.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🆕 Новый', 'w_new')],
          [Markup.button.callback('⬅️ Назад', 'w_back')],
        ])
      );
    }

    const buttons = wallets.map((w: any) => [
      Markup.button.callback(`${String(w.address).slice(-6)} · 💎 0`, `w_open_${w.id}`),
    ]);

    await ctx.reply(
      `У тебя: ${wallets.length} кошелёк(а)\nОбщий баланс: 💎 0`,
      Markup.inlineKeyboard([...buttons, [Markup.button.callback('🆕 Новый', 'w_new')]])
    );
  } catch (e: any) {
    await ctx.reply('Сервис кошельков недоступен. Попробуй позже.');
  }
});

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
  } catch (e: any) {
    await ctx.answerCbQuery('Ошибка сервера');
  }
});

bot.action(/^w_open_(\d+)$/, async (ctx) => {
  try {
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
  try {
    await ctx.deleteMessage();
  } catch {}
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
  transferState.delete(ctx.from.id);
  await ctx.reply('Отменено.');
});

bot.on('text', async (ctx, next) => {
  const st = transferState.get(ctx.from.id);
  if (!st) return next();

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
bot.telegram.setMyCommands([
  { command: 'start', description: 'Запуск и получение кошелька' },
  { command: 'help', description: 'Помощь' },
]);

// ---------- запуск ----------

(async () => {
  await ensurePolling();
  await bot.launch();
  console.log('🤖 Bot started (polling)');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
