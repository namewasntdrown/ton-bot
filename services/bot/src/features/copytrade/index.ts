import axios from 'axios';
import { Address } from '@ton/core';
import { Markup, Telegraf } from 'telegraf';
import { sendView, ViewMode } from '../../utils/telegram';
import { shortAddress } from '../../trading/service';

const WALLET_API = process.env.WALLET_API ?? 'http://127.0.0.1:8090';

type CopytradePlatform =
  | 'stonfi'
  | 'dedust'
  | 'tonfun'
  | 'gaspump'
  | 'memeslab'
  | 'blum';

const PLATFORM_OPTIONS: Array<{ key: CopytradePlatform; label: string }> = [
  { key: 'stonfi', label: 'STON.fi' },
  { key: 'dedust', label: 'DeDust.io' },
  { key: 'tonfun', label: 'TON.fun' },
  { key: 'gaspump', label: 'GasPump' },
  { key: 'memeslab', label: 'Memes Lab' },
  { key: 'blum', label: 'Blum' },
];
const PLATFORM_LABELS = PLATFORM_OPTIONS.reduce<Record<CopytradePlatform, string>>(
  (acc, option) => {
    acc[option.key] = option.label;
    return acc;
  },
  {
    stonfi: 'STON.fi',
    dedust: 'DeDust.io',
    tonfun: 'TON.fun',
    gaspump: 'GasPump',
    memeslab: 'Memes Lab',
    blum: 'Blum',
  }
);
const PLATFORM_LINKS: Record<CopytradePlatform, string> = {
  stonfi: 'https://app.ston.fi',
  dedust: 'https://dedust.io',
  tonfun: 'https://ton.fun',
  gaspump: 'https://gaspump.xyz',
  memeslab: 'https://memeslabs.io',
  blum: 'https://blum.codes',
};

type CopytradeProfile = {
  id: number;
  userId: number;
  sourceAddress: string | null;
  name: string | null;
  smartMode: boolean;
  manualAmountTon: number;
  slippagePercent: number;
  copyBuy: boolean;
  copySell: boolean;
  platforms: CopytradePlatform[];
  status: 'idle' | 'running';
  wallets: WalletOption[];
  updatedAt: number;
};

type InlineTarget = { chatId: number; messageId: number };

type CopytradePrompt =
  | { kind: 'name'; profileId: number; target?: InlineTarget }
  | { kind: 'source'; profileId: number; target?: InlineTarget }
  | { kind: 'amount'; profileId: number; target?: InlineTarget }
  | { kind: 'slippage'; profileId: number; target?: InlineTarget };

type WalletApiRecord = {
  id: number;
  address: string;
  label?: string;
  name?: string;
  balance?: string | null;
  balance_nton?: string | null;
  balanceNton?: string | null;
};

type WalletOption = {
  id: number;
  address: string;
  label?: string;
  balanceTon?: string;
};

const pendingPrompts = new Map<number, CopytradePrompt>();

export function registerCopytradeActions(bot: Telegraf<any>) {
  bot.action('copytrade_new', async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    try {
      const profile = await createProfile(ctx.from.id);
      await ctx.answerCbQuery('Профиль создан');
      await renderCopytradeProfile(ctx, profile.id);
    } catch {
      await ctx.answerCbQuery('Ошибка');
      await ctx.reply('Не удалось создать профиль копитрейдинга. Попробуй ещё раз.');
    }
  });

  bot.action('copytrade_help', async (ctx) => {
    await ctx.answerCbQuery();
    await renderCopytradeHelp(ctx);
  });

  bot.action(/^copytrade_profile:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = Number((ctx.match as RegExpMatchArray)[1]);
    await renderCopytradeProfile(ctx, id);
  });

  bot.action(/^copytrade_source:(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const message = ctx.callbackQuery?.message;
    if (!message?.chat?.id) {
      await ctx.answerCbQuery('Сообщение не найдено');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    pendingPrompts.set(ctx.from.id, {
      kind: 'source',
      profileId,
      target: { chatId: message.chat.id, messageId: message.message_id },
    });
    await ctx.answerCbQuery();
    await ctx.reply('Пришли TON-адрес кошелька трейдера, за которым будем следить. Для отмены жми /cancel.');
  });

  bot.action(/^copytrade_name:(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const message = ctx.callbackQuery?.message;
    if (!message?.chat?.id) {
      await ctx.answerCbQuery('Сообщение не найдено');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    pendingPrompts.set(ctx.from.id, {
      kind: 'name',
      profileId,
      target: { chatId: message.chat.id, messageId: message.message_id },
    });
    await ctx.answerCbQuery();
    await ctx.reply('Введи имя профиля (например, «Viewer»).');
  });

  bot.action(/^copytrade_amount:(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const message = ctx.callbackQuery?.message;
    if (!message?.chat?.id) {
      await ctx.answerCbQuery('Сообщение не найдено');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    pendingPrompts.set(ctx.from.id, {
      kind: 'amount',
      profileId,
      target: { chatId: message.chat.id, messageId: message.message_id },
    });
    await ctx.answerCbQuery();
    await ctx.reply('Введи фиксированную сумму TON для ручного режима (например, 5.5).');
  });

  bot.action(/^copytrade_slippage:(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const message = ctx.callbackQuery?.message;
    if (!message?.chat?.id) {
      await ctx.answerCbQuery('Сообщение не найдено');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    pendingPrompts.set(ctx.from.id, {
      kind: 'slippage',
      profileId,
      target: { chatId: message.chat.id, messageId: message.message_id },
    });
    await ctx.answerCbQuery();
    await ctx.reply('Укажи допустимый slippage в процентах (например, 1).');
  });

  bot.action(/^copytrade_wallets:(\d+)$/, async (ctx) => {
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    await ctx.answerCbQuery();
    await renderWalletSelector(ctx, profileId);
  });

  bot.action(/^copytrade_wallet_toggle:(\d+):(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    const walletId = Number((ctx.match as RegExpMatchArray)[2]);
    try {
      const profile = await fetchProfile(ctx.from.id, profileId);
      if (!profile) throw new Error('not_found');
      const ids = new Set(profile.wallets.map((w) => w.id));
      if (ids.has(walletId)) ids.delete(walletId);
      else ids.add(walletId);
      const updated = await setProfileWallets(ctx.from.id, profileId, Array.from(ids));
      await ctx.answerCbQuery(ids.has(walletId) ? 'Добавлено' : 'Удалено');
      await renderWalletSelector(ctx, profileId, 'edit', updated);
    } catch (err: any) {
      await ctx.answerCbQuery('Ошибка');
      await ctx.reply('Не удалось обновить список кошельков.');
    }
  });

  bot.action(/^copytrade_platforms:(\d+)$/, async (ctx) => {
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    await ctx.answerCbQuery();
    await renderPlatformSelector(ctx, profileId);
  });

  bot.action(/^copytrade_platform_toggle:(\d+):([a-z]+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    const platform = (ctx.match as RegExpMatchArray)[2] as CopytradePlatform;
    try {
      const profile = await fetchProfile(ctx.from.id, profileId);
      if (!profile) throw new Error('not_found');
      const next =
        profile.platforms.includes(platform)
          ? profile.platforms.filter((item) => item !== platform)
          : [...profile.platforms, platform];
      const updated = await patchProfile(ctx.from.id, profileId, { platforms: next });
      await ctx.answerCbQuery('Сохранено');
      await renderPlatformSelector(ctx, profileId, 'edit', updated);
    } catch {
      await ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action(/^copytrade_platform_all:(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    try {
      const updated = await patchProfile(ctx.from.id, profileId, {
        platforms: PLATFORM_OPTIONS.map((p) => p.key),
      });
      await ctx.answerCbQuery('Все выбрано');
      await renderPlatformSelector(ctx, profileId, 'edit', updated);
    } catch {
      await ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action(/^copytrade_platform_clear:(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    try {
      const updated = await patchProfile(ctx.from.id, profileId, { platforms: [] });
      await ctx.answerCbQuery('Список очищен');
      await renderPlatformSelector(ctx, profileId, 'edit', updated);
    } catch {
      await ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action(/^copytrade_toggle_smart:(\d+)$/, async (ctx) => {
    await toggleProfileField(ctx, Number((ctx.match as RegExpMatchArray)[1]), 'smartMode');
  });

  bot.action(/^copytrade_toggle_buy:(\d+)$/, async (ctx) => {
    await toggleProfileField(ctx, Number((ctx.match as RegExpMatchArray)[1]), 'copyBuy');
  });

  bot.action(/^copytrade_toggle_sell:(\d+)$/, async (ctx) => {
    await toggleProfileField(ctx, Number((ctx.match as RegExpMatchArray)[1]), 'copySell');
  });

  bot.action(/^copytrade_start:(\d+)$/, async (ctx) => {
    await changeProfileStatus(ctx, Number((ctx.match as RegExpMatchArray)[1]), 'running');
  });

  bot.action(/^copytrade_stop:(\d+)$/, async (ctx) => {
    await changeProfileStatus(ctx, Number((ctx.match as RegExpMatchArray)[1]), 'idle');
  });

  bot.action(/^copytrade_reset:(\d+)$/, async (ctx) => {
    if (!ctx.from?.id) {
      await ctx.answerCbQuery('Сначала запусти бота');
      return;
    }
    const profileId = Number((ctx.match as RegExpMatchArray)[1]);
    try {
      await patchProfile(ctx.from.id, profileId, {
        sourceAddress: null,
        name: null,
        smartMode: true,
        manualAmountTon: 1,
        slippagePercent: 100,
        copyBuy: true,
        copySell: false,
        platforms: PLATFORM_OPTIONS.map((item) => item.key),
        status: 'idle',
      });
      await setProfileWallets(ctx.from.id, profileId, []);
      await ctx.answerCbQuery('Сброшено');
      await renderCopytradeProfile(ctx, profileId);
    } catch {
      await ctx.answerCbQuery('Ошибка');
    }
  });
}

export async function renderCopytradeMenu(ctx: any, mode: ViewMode = 'edit') {
  const userId = ctx.from?.id;
  if (!userId) {
    return sendView(
      ctx,
      'Сначала запусти бота в личных сообщениях.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_home')]]),
      mode
    );
  }
  try {
    const profiles = await fetchProfiles(userId);
    const textParts = [
      '🤝 <b>Копи-трейдинг</b>',
      'Выбирай кошелёк-источник, подключай свои кошельки и бот будет повторять сделки.',
      '',
    ];
    if (!profiles.length) {
      textParts.push('Пока нет профилей. Создай новый и укажи адрес трейдера.');
    } else {
      profiles.forEach((profile, i) => {
        const name = profile.name ? `«${profile.name}»` : shortAddress(profile.sourceAddress || '—');
        textParts.push(
          `${i + 1}. ${name} · кошельков: ${profile.wallets.length} · статус: ${
            profile.status === 'running' ? '🚀' : '⏸'
          }`
        );
      });
    }
    const rows: ReturnType<typeof Markup.inlineKeyboard>['reply_markup']['inline_keyboard'] = profiles.map(
      (profile) => [
        Markup.button.callback(
          `${profile.status === 'running' ? '🟢' : '⚪️'} ${profileTitle(profile)}`,
          `copytrade_profile:${profile.id}`
        ),
      ]
    );
    rows.push([Markup.button.callback('➕ Новый профиль', 'copytrade_new')]);
    rows.push([Markup.button.callback('ℹ️ Как это работает', 'copytrade_help')]);
    rows.push([Markup.button.callback('⬅️ В главное меню', 'menu_home')]);
    return sendView(
      ctx,
      textParts.join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      },
      mode
    );
  } catch (err) {
    return sendView(
      ctx,
      'Не удалось получить список профилей. Попробуй ещё раз позже.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_home')]]),
      mode
    );
  }
}

export async function handleCopytradeTextInput(ctx: any, text?: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  const prompt = pendingPrompts.get(userId);
  if (!prompt) return false;
  const value = text?.trim();
  if (!value) {
    await ctx.reply('Жду текстовое значение или /cancel.');
    return true;
  }
  try {
    if (prompt.kind === 'name') {
      await patchProfile(userId, prompt.profileId, { name: value.slice(0, 64) });
    } else if (prompt.kind === 'source') {
      const normalized = normalizeTonAddress(value);
      if (!normalized) {
        await ctx.reply('Не удалось распознать адрес. Пришли корректный friendly-адрес.');
        return true;
      }
      await patchProfile(userId, prompt.profileId, { sourceAddress: normalized });
    } else if (prompt.kind === 'amount') {
      const ton = Number(value.replace(',', '.'));
      if (!Number.isFinite(ton) || ton <= 0) {
        await ctx.reply('Нужна положительная сумма TON.');
        return true;
      }
      await patchProfile(userId, prompt.profileId, { manualAmountTon: Number(ton.toFixed(4)) });
    } else if (prompt.kind === 'slippage') {
      const percentage = Number(value.replace(',', '.'));
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 500) {
        await ctx.reply('Укажи значение от 0 до 500%.');
        return true;
      }
      await patchProfile(userId, prompt.profileId, {
        slippagePercent: Number(percentage.toFixed(2)),
      });
    }
    pendingPrompts.delete(userId);
    await ctx.reply('Сохранено.');
    await renderCopytradeProfile(ctx, prompt.profileId, 'edit');
  } catch {
    await ctx.reply('Не получилось сохранить. Попробуй ещё раз.');
  }
  return true;
}

export function cancelCopytradeInput(userId?: number) {
  if (!userId) return;
  pendingPrompts.delete(userId);
}

async function changeProfileStatus(ctx: any, profileId: number, status: 'idle' | 'running') {
  if (!ctx.from?.id) {
    await ctx.answerCbQuery('Сначала запусти бота');
    return;
  }
  try {
    await patchProfile(ctx.from.id, profileId, { status });
    await ctx.answerCbQuery(status === 'running' ? 'Запущено' : 'Остановлено');
    await renderCopytradeProfile(ctx, profileId);
  } catch (err: any) {
    const code = err?.response?.data?.error;
    let message = 'Не удалось обновить статус.';
    if (code === 'invalid_source_address') {
      message = 'Укажи кошелёк-источник, прежде чем запускать копитрейдинг.';
    }
    await ctx.answerCbQuery('Ошибка');
    await ctx.reply(message);
  }
}

async function toggleProfileField(
  ctx: any,
  profileId: number,
  field: 'smartMode' | 'copyBuy' | 'copySell'
) {
  if (!ctx.from?.id) {
    await ctx.answerCbQuery('Сначала запусти бота');
    return;
  }
  try {
    const profile = await fetchProfile(ctx.from.id, profileId);
    if (!profile) {
      await ctx.answerCbQuery('Недоступно');
      return;
    }
    const patch: Partial<CopytradeProfilePatch> = {};
    if (field === 'smartMode') patch.smartMode = !profile.smartMode;
    if (field === 'copyBuy') patch.copyBuy = !profile.copyBuy;
    if (field === 'copySell') patch.copySell = !profile.copySell;
    await patchProfile(ctx.from.id, profileId, patch);
    await ctx.answerCbQuery('Сохранено');
    await renderCopytradeProfile(ctx, profileId);
  } catch {
    await ctx.answerCbQuery('Ошибка');
  }
}

async function renderCopytradeProfile(
  ctx: any,
  profileId: number,
  mode: ViewMode = 'edit',
  existing?: CopytradeProfile,
  target?: InlineTarget
) {
  const userId = ctx.from?.id;
  if (!userId) {
    return sendView(
      ctx,
      'Сначала запусти бота.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_home')]]),
      mode
    );
  }
  try {
    const profile = existing || (await fetchProfile(userId, profileId));
    if (!profile) {
      return sendView(
        ctx,
        'Профиль не найден или был удалён.',
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_copytrade')]]),
        mode
      );
    }
    const wallets = await fetchWalletOptions(userId).catch(() => []);
    const view = buildProfileView(profile, wallets);
    if (target) {
      await ctx.telegram.editMessageText(target.chatId, target.messageId, undefined, view.text, view.extra);
      return;
    }
    return sendView(ctx, view.text, view.extra, mode);
  } catch {
    return sendView(
      ctx,
      'Не удалось загрузить профиль.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_copytrade')]]),
      mode
    );
  }
}

async function renderWalletSelector(
  ctx: any,
  profileId: number,
  mode: ViewMode = 'edit',
  existing?: CopytradeProfile
) {
  const userId = ctx.from?.id;
  if (!userId) {
    return sendView(
      ctx,
      'Сначала запусти бота.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_copytrade')]]),
      mode
    );
  }
  try {
    const profile = existing || (await fetchProfile(userId, profileId));
    if (!profile) throw new Error('not_found');
    const wallets = await fetchWalletOptions(userId);
    if (!wallets.length) {
      return sendView(
        ctx,
        'У тебя ещё нет кошельков. Создай их в разделе «Кошельки», затем вернись сюда.',
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `copytrade_profile:${profile.id}`)]]),
        mode
      );
    }
    const selectedIds = new Set(profile.wallets.map((w) => w.id));
    const rows = wallets.map((wallet) => [
      Markup.button.callback(
        `${selectedIds.has(wallet.id) ? '✅' : '☐'} ${formatWalletLabel(wallet)}`,
        `copytrade_wallet_toggle:${profile.id}:${wallet.id}`
      ),
    ]);
    rows.push([Markup.button.callback('⬅️ Готово', `copytrade_profile:${profile.id}`)]);
    return sendView(
      ctx,
      [
        '👛 <b>Выбор кошельков</b>',
        'Отметь кошельки, с которых бот будет повторять сделки.',
        `Сейчас выбрано: ${selectedIds.size}`,
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      },
      mode
    );
  } catch {
    return sendView(
      ctx,
      'Не удалось получить список кошельков.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_copytrade')]]),
      mode
    );
  }
}

async function renderPlatformSelector(
  ctx: any,
  profileId: number,
  mode: ViewMode = 'edit',
  existing?: CopytradeProfile
) {
  const userId = ctx.from?.id;
  if (!userId) {
    return sendView(
      ctx,
      'Сначала запусти бота.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_copytrade')]]),
      mode
    );
  }
  try {
    const profile = existing || (await fetchProfile(userId, profileId));
    if (!profile) throw new Error('not_found');
    const rows = PLATFORM_OPTIONS.map((option) => [
      Markup.button.callback(
        `${profile.platforms.includes(option.key) ? '✅' : '☐'} ${option.label}`,
        `copytrade_platform_toggle:${profile.id}:${option.key}`
      ),
    ]);
    rows.push([
      Markup.button.callback('Выбрать все', `copytrade_platform_all:${profile.id}`),
      Markup.button.callback('Очистить', `copytrade_platform_clear:${profile.id}`),
    ]);
    rows.push([Markup.button.callback('⬅️ Готово', `copytrade_profile:${profile.id}`)]);
    return sendView(
      ctx,
      ['🏦 <b>Платформы</b>', 'Отметь площадки, сделки с которых будем копировать.'].join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      },
      mode
    );
  } catch {
    return sendView(
      ctx,
      'Не удалось загрузить настройки платформ.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_copytrade')]]),
      mode
    );
  }
}

async function renderCopytradeHelp(ctx: any, mode: ViewMode = 'edit') {
  const text = [
    '⚙️ <b>Как работает копитрейдинг</b>',
    '',
    '👛 Укажите кошелёк-источник — адрес трейдера, чьи сделки хотите повторять.',
    '🔄 Все его покупки и продажи автоматически дублируются на выбранных ваших кошельках.',
    '🏷 Каждому ордеру можно задать имя, чтобы не потерять его в списке.',
    '👛 Выберите, с каких ваших кошельков выполняется копирование.',
    '🏦 Доступны фильтры по платформам: STON.fi, DeDust.io, TON.fun, GasPump, Memes Lab, Blum.',
    '📉 Настройте slippage под свою стратегию.',
    '↔️ Можно отдельно копировать покупки или продажи, либо оба типа.',
    '',
    '💰 <b>Сумма сделки</b>',
    '• ✏️ Ручной режим — фиксированная сумма TON для каждой сделки.',
    '• 🤖 Смарт-режим — бот рассчитывает объём по сделке трейдера (использует те же значения TON).',
    '',
    '📎 Дополнительно: кнопки «Запуск», «Отмена», «Сброс» и «Назад» позволяют управлять профилем копитрейдинга.',
  ].join('\n');
  return sendView(
    ctx,
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'menu_copytrade')]]),
    },
    mode
  );
}

function buildProfileView(profile: CopytradeProfile, wallets: WalletOption[]) {
  const sourceText = profile.sourceAddress ? `<code>${profile.sourceAddress}</code>` : 'не задан';
  const nameText = profile.name || 'не задано';
  const walletMap = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const selectedWallets = profile.wallets
    .map((wallet) => walletMap.get(wallet.id) || wallet)
    .map((wallet) => formatWalletLabel(wallet));
  const walletText = selectedWallets.length ? selectedWallets.join('\n') : 'кошельки не выбраны';
  const platformsText = profile.platforms.length
    ? profile.platforms
        .map((key) => {
          const label = PLATFORM_LABELS[key] || key;
          const href = PLATFORM_LINKS[key];
          return href ? `<a href="${href}">${label}</a>` : label;
        })
        .join(', ')
    : 'ничего не выбрано';
  const amountText = profile.smartMode
    ? '🤖 Смарт-режим (используется объём сделки лидера)'
    : `✏️ ${profile.manualAmountTon} TON`;
  const statusText = profile.status === 'running' ? '🚀 запущен' : '⏸ остановлен';
  const lines = [
    '🤝 <b>Копи-трейдинг</b>',
    `🔗 Источник: ${sourceText}`,
    '',
    `🏷 Имя: <b>${nameText}</b>`,
    `👛 Кошельки:\n${walletText}`,
    `🏦 Платформы: ${platformsText}`,
    `💰 Сумма сделки: ${amountText}`,
    `📉 Slippage: ${profile.slippagePercent}%`,
    `↔️ Типы ордеров: ${profile.copyBuy ? '✅ покупка' : '⛔ покупка'} · ${
      profile.copySell ? '✅ продажа' : '⛔ продажа'
    }`,
    `📡 Статус: ${statusText}`,
    '',
    'Настрой кнопками ниже:',
  ];
  const rows: ReturnType<typeof Markup.inlineKeyboard>['reply_markup']['inline_keyboard'] = [];
  if (profile.sourceAddress) {
    rows.push([Markup.button.url('🌐 TON Viewer', `https://tonviewer.com/${profile.sourceAddress}`)]);
  }
  rows.push([Markup.button.callback(profile.sourceAddress ? '🔁 Сменить источник' : '➕ Указать источник', `copytrade_source:${profile.id}`)]);
  rows.push([Markup.button.callback(`🏷 Имя (${nameText || 'не задано'})`, `copytrade_name:${profile.id}`)]);
  rows.push([Markup.button.callback(`👛 Кошельки (${profile.wallets.length})`, `copytrade_wallets:${profile.id}`)]);
  rows.push([
    Markup.button.callback(
      `🏦 Платформы (${profile.platforms.length}/${PLATFORM_OPTIONS.length})`,
      `copytrade_platforms:${profile.id}`
    ),
  ]);
  rows.push([Markup.button.callback(profile.smartMode ? '✅ Умный режим' : '☑️ Умный режим', `copytrade_toggle_smart:${profile.id}`)]);
  rows.push([Markup.button.callback(profile.copyBuy ? '✅ Покупка' : '☐ Покупка', `copytrade_toggle_buy:${profile.id}`)]);
  rows.push([Markup.button.callback(`💰 Сумма (${profile.smartMode ? 'смарт' : `${profile.manualAmountTon} TON`})`, `copytrade_amount:${profile.id}`)]);
  rows.push([Markup.button.callback(`📉 Slippage (${profile.slippagePercent}%)`, `copytrade_slippage:${profile.id}`)]);
  rows.push([Markup.button.callback(profile.copySell ? '✅ Продажа' : '☐ Продажа', `copytrade_toggle_sell:${profile.id}`)]);
  rows.push([
    Markup.button.callback('🚀 Запуск', `copytrade_start:${profile.id}`),
    Markup.button.callback('⛔ Отмена', `copytrade_stop:${profile.id}`),
  ]);
  rows.push([
    Markup.button.callback('🔁 Сброс', `copytrade_reset:${profile.id}`),
    Markup.button.callback('⬅️ Назад', 'menu_copytrade'),
  ]);
  return {
    text: lines.join('\n'),
    extra: {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard(rows),
    },
  };
}

function profileTitle(profile: CopytradeProfile): string {
  if (profile.name) return profile.name;
  if (profile.sourceAddress) return shortAddress(profile.sourceAddress);
  const date = new Date(profile.updatedAt);
  return `Профиль от ${date.toLocaleDateString('ru-RU')}`;
}

function normalizeTonAddress(value: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const friendly = Address.parseFriendly(trimmed);
    return friendly.address.toString({ bounceable: false, urlSafe: true });
  } catch {
    try {
      return Address.parse(trimmed).toString({ bounceable: false, urlSafe: true });
    } catch {
      return null;
    }
  }
}

async function fetchWalletOptions(userId: number): Promise<WalletOption[]> {
  const { data } = await axios.get(`${WALLET_API}/wallets`, {
    params: { user_id: userId, with_balance: 1 },
    timeout: 10_000,
  });
  if (!Array.isArray(data)) return [];
  return data
    .map((item: WalletApiRecord) => {
      const balanceRaw = item.balance_nton ?? item.balance ?? item.balanceNton ?? undefined;
      const balanceTon = balanceRaw ? formatTonFromNano(balanceRaw) : undefined;
      return {
        id: item.id,
        address: item.address,
        label: item.label || item.name || undefined,
        balanceTon,
      };
    })
    .filter((item) => Boolean(item.address));
}

function formatWalletLabel(option: WalletOption): string {
  const base = shortAddress(option.address);
  const alias = option.label ? `${option.label} (${base})` : base;
  return option.balanceTon ? `${alias} · ${option.balanceTon} TON` : alias;
}

function formatTonFromNano(value: unknown): string {
  let nano: bigint;
  try {
    if (typeof value === 'bigint') {
      nano = value;
    } else if (typeof value === 'number') {
      nano = BigInt(Math.trunc(value));
    } else if (typeof value === 'string') {
      nano = BigInt(value);
    } else {
      return '0';
    }
  } catch {
    return '0';
  }
  const intPart = nano / 1_000_000_000n;
  let frac = (nano % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart.toString();
}

type CopytradeProfilePatch = {
  sourceAddress?: string | null;
  name?: string | null;
  smartMode?: boolean;
  manualAmountTon?: number | null;
  slippagePercent?: number | null;
  copyBuy?: boolean;
  copySell?: boolean;
  platforms?: CopytradePlatform[];
  status?: 'idle' | 'running';
};

async function fetchProfiles(userId: number): Promise<CopytradeProfile[]> {
  const { data } = await axios.get(`${WALLET_API}/copytrade/profiles`, {
    params: { user_id: userId },
    timeout: 10_000,
  });
  if (!Array.isArray(data)) return [];
  return data.map(mapProfileDto);
}

async function fetchProfile(userId: number, profileId: number): Promise<CopytradeProfile | null> {
  const profiles = await fetchProfiles(userId);
  return profiles.find((profile) => profile.id === profileId) || null;
}

async function createProfile(userId: number): Promise<CopytradeProfile> {
  const { data } = await axios.post(
    `${WALLET_API}/copytrade/profiles`,
    { user_id: userId },
    { timeout: 10_000 }
  );
  return mapProfileDto(data);
}

async function patchProfile(
  userId: number,
  profileId: number,
  patch: CopytradeProfilePatch
): Promise<CopytradeProfile> {
  const payload: any = { user_id: userId };
  if (patch.sourceAddress !== undefined) payload.source_address = patch.sourceAddress;
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.smartMode !== undefined) payload.smart_mode = patch.smartMode;
  if (patch.manualAmountTon !== undefined) payload.manual_amount_ton = patch.manualAmountTon;
  if (patch.slippagePercent !== undefined) payload.slippage_percent = patch.slippagePercent;
  if (patch.copyBuy !== undefined) payload.copy_buy = patch.copyBuy;
  if (patch.copySell !== undefined) payload.copy_sell = patch.copySell;
  if (patch.platforms !== undefined) payload.platforms = patch.platforms;
  if (patch.status !== undefined) payload.status = patch.status;
  const { data } = await axios.patch(
    `${WALLET_API}/copytrade/profiles/${profileId}`,
    payload,
    { timeout: 10_000 }
  );
  return mapProfileDto(data);
}

async function setProfileWallets(
  userId: number,
  profileId: number,
  walletIds: number[]
): Promise<CopytradeProfile> {
  const { data } = await axios.post(
    `${WALLET_API}/copytrade/profiles/${profileId}/wallets`,
    { user_id: userId, wallet_ids: walletIds },
    { timeout: 10_000 }
  );
  return mapProfileDto(data);
}

function mapProfileDto(dto: any): CopytradeProfile {
  return {
    id: Number(dto?.id),
    userId: Number(dto?.user_id),
    sourceAddress: dto?.source_address ?? null,
    name: dto?.name ?? null,
    smartMode: Boolean(dto?.smart_mode ?? true),
    manualAmountTon: toNumber(dto?.manual_amount_ton, 1),
    slippagePercent: toNumber(dto?.slippage_percent, 100),
    copyBuy: dto?.copy_buy !== false,
    copySell: Boolean(dto?.copy_sell),
    platforms: Array.isArray(dto?.platforms) && dto.platforms.length
      ? dto.platforms
      : PLATFORM_OPTIONS.map((item) => item.key),
    status: dto?.status === 'running' ? 'running' : 'idle',
    wallets: Array.isArray(dto?.wallets)
      ? dto.wallets.map((wallet: any) => ({
          id: Number(wallet?.id),
          address: String(wallet?.address || ''),
        }))
      : [],
    updatedAt: Date.parse(dto?.updated_at || dto?.created_at || new Date().toISOString()),
  };
}

function toNumber(value: any, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
