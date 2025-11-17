import { Address } from '@ton/ton';
import type { FastifyBaseLogger } from 'fastify';
import {
  getWalletById,
  insertSwapOrder,
  listCopytradeProfilesBySource,
  type SwapOrderRow,
} from './db';

function normalizeWalletAddress(value?: string | null): string | null {
  if (!value) return null;
  try {
    return Address.parse(value).toString({ bounceable: false, urlSafe: true });
  } catch {
    try {
      const friendly = Address.parseFriendly(value);
      return friendly.address.toString({ bounceable: false, urlSafe: true });
    } catch {
      return null;
    }
  }
}

export type CopytradeSignalPayload = {
  sourceAddress: string;
  direction: 'buy' | 'sell';
  tokenAddress: string;
  tonAmount: number;
  limitPriceTon?: number | null;
  sellPercent?: number | null;
  platform?: string | null;
  parentOrderId?: number | null;
};

export async function fanoutCopytradeSignal(
  payload: CopytradeSignalPayload,
  logger: FastifyBaseLogger
) {
  if (!payload.sourceAddress) return;
  const normalized = normalizeWalletAddress(payload.sourceAddress);
  if (!normalized) return;
  const followers = await listCopytradeProfilesBySource(normalized);
  if (!followers.length) return;
  const tonAmountNumber = Number(payload.tonAmount);
  if (!Number.isFinite(tonAmountNumber) || tonAmountNumber <= 0) {
    return;
  }
  const limitPriceNumber =
    payload.limitPriceTon !== null && payload.limitPriceTon !== undefined
      ? Number(payload.limitPriceTon)
      : null;
  const sellPercentNumber =
    payload.sellPercent !== null && payload.sellPercent !== undefined
      ? Number(payload.sellPercent)
      : null;
  await Promise.all(
    followers.map(async (profile) => {
      if (
        (payload.direction === 'buy' && !profile.copy_buy) ||
        (payload.direction === 'sell' && !profile.copy_sell)
      ) {
        return;
      }
      if (
        payload.platform &&
        profile.platforms?.length &&
        !profile.platforms.includes(payload.platform as any)
      ) {
        return;
      }
      if (!profile.wallet_ids.length) return;
      const followerTonAmount =
        payload.direction === 'buy'
          ? profile.smart_mode
            ? tonAmountNumber
            : Number(profile.manual_amount_ton || tonAmountNumber || 0)
          : tonAmountNumber;
      if (!Number.isFinite(followerTonAmount) || followerTonAmount <= 0) {
        return;
      }
      const followerSellPercent =
        payload.direction === 'sell'
          ? sellPercentNumber ?? Number(profile.manual_amount_ton || '100')
          : null;
      if (
        payload.direction === 'sell' &&
        (followerSellPercent === null || followerSellPercent <= 0)
      ) {
        return;
      }
      await Promise.all(
        profile.wallet_ids.map(async (walletId) => {
          try {
            await insertSwapOrder({
              user_id: profile.user_id,
              wallet_id: walletId,
              token_address: payload.tokenAddress,
              direction: payload.direction,
              ton_amount: followerTonAmount,
              limit_price: limitPriceNumber ?? undefined,
              sell_percent: followerSellPercent ?? undefined,
              copytrade_parent_id: payload.parentOrderId ?? null,
            });
          } catch (err: any) {
            logger.error(
              {
                err: err?.message || err,
                followerUserId: profile.user_id,
                followerWalletId: walletId,
                parentOrderId: payload.parentOrderId ?? null,
              },
              'copytrade_order_insert_failed'
            );
          }
        })
      );
    })
  );
}

export async function fanoutCopytradeOrder(
  order: SwapOrderRow,
  logger: FastifyBaseLogger
) {
  if (order.copytrade_parent_id) return;
  const wallet = await getWalletById(order.wallet_id);
  if (!wallet) return;
  await fanoutCopytradeSignal(
    {
      sourceAddress: wallet.address,
      direction: order.direction,
      tokenAddress: order.token_address,
      tonAmount: Number(order.ton_amount),
      limitPriceTon:
        order.limit_price !== null && order.limit_price !== undefined
          ? Number(order.limit_price)
          : null,
      sellPercent:
        order.sell_percent !== null && order.sell_percent !== undefined
          ? Number(order.sell_percent)
          : null,
      parentOrderId: order.id,
    },
    logger
  );
}
