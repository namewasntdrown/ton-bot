type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
};

const walletApiBase =
  import.meta.env.VITE_WALLET_API_BASE?.replace(/\/$/, '') || 'http://localhost:8090';
const coreApiBase =
  import.meta.env.VITE_CORE_API_BASE?.replace(/\/$/, '') || 'http://localhost:8080';
const relayerHealthUrl = import.meta.env.VITE_RELAYER_HEALTH_URL?.trim() || '';

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    method: options.method ?? 'GET',
    body: options.body ?? null,
    cache: 'no-store',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return (await response.json()) as T;
}

export async function fetchWalletApiHealth() {
  return request<{ ok: boolean }>(`${walletApiBase}/health`);
}

export async function fetchCoreApiHealth() {
  return request<{ ok: boolean }>(`${coreApiBase}/health`);
}

export type WalletRow = { id: number; address: string; balance_ton?: string };

export async function fetchWallets(userId: number) {
  const url = new URL(`${walletApiBase}/wallets`);
  url.searchParams.set('user_id', String(userId));
  url.searchParams.set('with_balance', '1');
  return request<WalletRow[]>(url.toString());
}

export async function createWallet(userId: number) {
  return request<WalletRow>(`${walletApiBase}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
}

export type TransferPayload = {
  userId: number;
  walletId: number;
  to: string;
  amountTon: number;
  comment?: string;
};

export async function transferTon(payload: TransferPayload) {
  return request<{ ok: boolean }>(`${walletApiBase}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: payload.userId,
      wallet_id: payload.walletId,
      to: payload.to,
      amount_ton: payload.amountTon,
      comment: payload.comment,
    }),
  });
}

export type SwapOrder = {
  id: number;
  wallet_id: number;
  token_address: string;
  direction: string;
  ton_amount: string;
  limit_price?: string | null;
  sell_percent?: string | null;
  status: string;
  error?: string | null;
  tx_hash?: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchSwapOrders(userId: number) {
  const url = new URL(`${walletApiBase}/swap_orders`);
  url.searchParams.set('user_id', String(userId));
  return request<SwapOrder[]>(url.toString());
}

export type PositionRow = {
  id: number;
  wallet_id: number;
  token_address: string;
  token_symbol?: string | null;
  token_name?: string | null;
  token_image?: string | null;
  amount: string;
  invested_ton: string;
  is_hidden: boolean;
  updated_at: string;
  wallet_address?: string | null;
};

export async function fetchPositions(userId: number) {
  const url = new URL(`${walletApiBase}/positions`);
  url.searchParams.set('user_id', String(userId));
  return request<PositionRow[]>(url.toString());
}

export type RelayerHealth = {
  ok: boolean;
  pending: number;
  lastBroadcastAt?: string | null;
  lastError?: string | null;
};

export const hasRelayerHealthEndpoint = Boolean(relayerHealthUrl);

export async function fetchRelayerHealth() {
  if (!relayerHealthUrl) {
    throw new Error('relayer_health_url_not_configured');
  }
  return request<RelayerHealth>(relayerHealthUrl);
}
