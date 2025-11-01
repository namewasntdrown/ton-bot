import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не задан в .env (services/bot/.env)');
  process.exit(1);
}
const TON_RPC = process.env.TON_RPC_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
const API = 'http://localhost:8080';
const userIdOf = (ctx: any) => String(ctx.from?.id || ctx.chat?.id);

const bot = new Telegraf(BOT_TOKEN);

const mainMenu = Markup.keyboard([
  [Markup.button.text('🏆 Торговый конкурс'), Markup.button.text('💼 Позиции')],
  [Markup.button.text('💸 Перевод'), Markup.button.text('🔎 Поиск токенов')],
  [Markup.button.text('🤖 Копи-трейдинг'), Markup.button.text('🎯 Снайпы')],
  [Markup.button.text('🧱 Лимитки [BETA]'), Markup.button.text('🤝 Рефералка')],
  [Markup.button.text('🆘 Помощь'), Markup.button.text('⚙️ Настройки')],
  [Markup.button.text('📚 Руководство'), Markup.button.text('💰 Баланс')],
  [Markup.button.text('👛 Кошельки')]
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

bot.hears('👛 Кошельки', async (ctx) => {
  const userId = userIdOf(ctx);
  const { data } = await axios.get(`${API}/wallets`, { params: { user_id: userId } });
  const list: string[] = data.wallets || [];
  const text = list.length
    ? '👛 Кошельки:\n' + list.map((a, i) => `${i + 1}. ${a}`).join('\n')
    : 'Пока нет добавленных адресов.';
  await ctx.reply(`${text}\n\n➕ Пришли TON-адрес сообщением.\n🗑 Для удаления отправь: delete <адрес>`);
});

bot.on('text', async (ctx, next) => {
  const t = (ctx.message as any)?.text?.trim() || '';
  if (t.toLowerCase().startsWith('delete ')) return next();
  if (/^(E|U)Q[0-9A-Za-z_-]{46,}$/i.test(t)) {
    const userId = userIdOf(ctx);
    await axios.post(`${API}/wallets`, { user_id: userId, address: t })
      .then(() => ctx.reply('✅ Адрес добавлен.'))
      .catch((e: any) => ctx.reply(`❌ ${e.response?.data?.error || e.message}`));
    return;
  }
  return next();
});

bot.hears(/^delete\s+/i, async (ctx) => {
  const userId = userIdOf(ctx);
  const address = (ctx.message as any).text.replace(/^delete\s+/i, '').trim();
  if (!/^(E|U)Q[0-9A-Za-z_-]{46,}$/i.test(address)) return ctx.reply('❌ Неверный TON-адрес.');
  await axios.delete(`${API}/wallets`, { data: { user_id: userId, address } })
    .then(() => ctx.reply('🗑 Адрес удалён.'))
    .catch((e: any) => ctx.reply(`❌ ${e.response?.data?.error || e.message}`));
});

bot.launch().then(() => console.log('🤖 Bot started (polling)'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
