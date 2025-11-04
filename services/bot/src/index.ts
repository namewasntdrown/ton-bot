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
  process.env.TON_RPC_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';

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

  // Пытаемся получить/создать кошелёк
  try {
    const alive = await pingWalletApi();
    if (!alive) {
      await ctx.reply('😔 Сервис кошельков временно недоступен. Попробуй позже.');
    } else {
      const { data } = await axios.post(
        `${WALLET_API}/register`,
        { user_id: userId },
        { timeout: 10_000 }
      );

      const address: string | undefined = data?.address;
      if (!address) throw new Error(`wallet-api ответ: ${JSON.stringify(data)}`);

      const tonviewer = `https://tonviewer.com/${address}`;
      await ctx.reply(
        `💎 Твой кошелёк:\n<code>${address}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('Открыть в Tonviewer', tonviewer)],
          ]),
        }
      );
    }
  } catch (e: any) {
    console.error('register error:', e?.response?.data || e?.message);
    await ctx.reply('😔 Не удалось создать/получить кошелёк. Попробуй позже.');
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
