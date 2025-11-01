import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не задан в .env (services/bot/.env)');
  process.exit(1);
}
const TON_RPC = process.env.TON_RPC_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';

const bot = new Telegraf(BOT_TOKEN);

const mainMenu = Markup.keyboard([
  [Markup.button.text('🏆 Торговый конкурс'), Markup.button.text('💼 Позиции')],
  [Markup.button.text('💸 Перевод'), Markup.button.text('🔎 Поиск токенов')],
  [Markup.button.text('🤖 Копи-трейдинг'), Markup.button.text('🎯 Снайпы')],
  [Markup.button.text('🧱 Лимитки [BETA]'), Markup.button.text('🤝 Рефералка')],
  [Markup.button.text('🆘 Помощь'), Markup.button.text('⚙️ Настройки')],
  [Markup.button.text('📚 Руководство'), Markup.button.text('💰 Баланс')]
]).resize();

bot.start(async (ctx) => {
  await ctx.reply('Привет! Я помогу тебе торговать на TON быстрее всех 🚀', mainMenu);
});

bot.hears('💰 Баланс', async (ctx) => {
  const testAddress = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
  try {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getAddressInformation',
      params: { address: testAddress }
    };
    const { data } = await axios.post(TON_RPC, payload, { timeout: 10_000 });
    const balance = data?.result?.balance ? Number(data.result.balance) / 1e9 : 0;
    await ctx.reply(`Баланс адреса (демо): ${balance} TON\n\nRaw: ${JSON.stringify(data.result ?? data)}`);
  } catch (e: any) {
    await ctx.reply(`Не смог получить баланс от RPC: ${e.message}`);
  }
});

bot.hears('🎯 Снайпы', (ctx) => ctx.reply('Снайпер: скоро добавим стратегию и подписку на листинги.'));
bot.hears('🤖 Копи-трейдинг', (ctx) => ctx.reply('Копитрейдинг: список трейдеров появится позже.'));

bot.launch().then(() => console.log('🤖 Bot started (polling)'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
