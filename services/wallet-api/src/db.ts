import 'dotenv/config';
import { cleanEnv, str, num } from 'envalid';
import { Pool, types } from 'pg';
// Interpret BIGINT (int8) as JS number when safe
types.setTypeParser(20, (val) => {
  const n = Number(val);
  return Number.isNaN(n) ? undefined as any : n;
});

// First, check if DATABASE_URL is provided; otherwise validate individual fields
const baseEnv = cleanEnv(process.env, {
  DATABASE_URL: str({ default: '' }),
});

let pool: Pool;

if (baseEnv.DATABASE_URL) {
  pool = new Pool({ connectionString: baseEnv.DATABASE_URL });
} else {
  const env = cleanEnv(process.env, {
    PGHOST: str(),
    PGPORT: num({ default: 5432 }),
    PGUSER: str(),
    PGPASSWORD: str(), // ensure password stays a string
    PGDATABASE: str(),
  });

  pool = new Pool({
    host: env.PGHOST,
    port: env.PGPORT,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE,
  });
}

export async function migrate() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS wallets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      address TEXT NOT NULL,
      encrypted_mnemonic TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
    CREATE TABLE IF NOT EXISTS user_trading_profiles (
      user_id BIGINT PRIMARY KEY,
      active_wallet_id BIGINT REFERENCES wallets(id) ON DELETE SET NULL,
      ton_amount NUMERIC,
      buy_limit_price NUMERIC,
      sell_percent NUMERIC,
      trade_mode TEXT NOT NULL DEFAULT 'buy',
      last_token TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS swap_orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      token_address TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
      ton_amount NUMERIC NOT NULL,
      limit_price NUMERIC,
      sell_percent NUMERIC,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      tx_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_swap_orders_user ON swap_orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_swap_orders_wallet ON swap_orders(wallet_id);

    ALTER TABLE user_trading_profiles
      ADD COLUMN IF NOT EXISTS ton_amount NUMERIC,
      ADD COLUMN IF NOT EXISTS buy_limit_price NUMERIC,
      ADD COLUMN IF NOT EXISTS sell_percent NUMERIC,
      ADD COLUMN IF NOT EXISTS trade_mode TEXT,
      ADD COLUMN IF NOT EXISTS last_token TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    UPDATE user_trading_profiles
      SET trade_mode = 'buy'
      WHERE trade_mode IS NULL;
    ALTER TABLE user_trading_profiles
      ALTER COLUMN trade_mode SET DEFAULT 'buy';
    ALTER TABLE user_trading_profiles
      ALTER COLUMN trade_mode SET NOT NULL;

    ALTER TABLE swap_orders
      ADD COLUMN IF NOT EXISTS sell_percent NUMERIC,
      ADD COLUMN IF NOT EXISTS limit_price NUMERIC,
      ADD COLUMN IF NOT EXISTS error TEXT,
      ADD COLUMN IF NOT EXISTS tx_hash TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);
}

export async function listWalletsByUser(userId: number) {
  const r = await pool.query(
    `SELECT id, address, created_at FROM wallets WHERE user_id = $1 ORDER BY id ASC`,
    [userId]
  );
  return r.rows as { id: number; address: string; created_at: string }[];
}

export async function countWalletsByUser(userId: number) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM wallets WHERE user_id = $1`,
    [userId]
  );
  return (r.rows[0]?.c as number) || 0;
}

export async function insertWallet(row: {
  user_id: number;
  address: string;
  encrypted_mnemonic: string;
}) {
  const r = await pool.query(
    `INSERT INTO wallets (user_id, address, encrypted_mnemonic)
     VALUES ($1, $2, $3)
     RETURNING id, address, created_at`,
    [row.user_id, row.address, row.encrypted_mnemonic]
  );
  return r.rows[0] as { id: number; address: string; created_at: string };
}

export async function getWalletById(id: number) {
  const r = await pool.query(
    `SELECT id, user_id, address, created_at FROM wallets WHERE id = $1`,
    [id]
  );
  return (r.rows[0] as { id: number; user_id: number; address: string; created_at: string }) || null;
}

export { pool };

export async function getWalletSecretById(id: number) {
  const r = await pool.query(
    `SELECT id, user_id, address, encrypted_mnemonic FROM wallets WHERE id = $1`,
    [id]
  );
  return (r.rows[0] as { id: number; user_id: number; address: string; encrypted_mnemonic: string }) || null;
}

// Utility listing pairs of (user_id, address) across all wallets
export async function listAllUserWallets() {
  const r = await pool.query(
    `SELECT user_id, address FROM wallets ORDER BY user_id ASC, id ASC`
  );
  return r.rows as { user_id: number; address: string }[];
}

export type TradingProfileRow = {
  user_id: number;
  active_wallet_id: number | null;
  ton_amount: string | null;
  buy_limit_price: string | null;
  sell_percent: string | null;
  trade_mode: string;
  last_token: string | null;
  updated_at: string;
};

export async function getTradingProfile(userId: number): Promise<TradingProfileRow | null> {
  const r = await pool.query(
    `SELECT user_id, active_wallet_id, ton_amount::text, buy_limit_price::text, sell_percent::text, trade_mode, last_token, updated_at
     FROM user_trading_profiles WHERE user_id = $1`,
    [userId]
  );
  return (r.rows[0] as TradingProfileRow) || null;
}

export async function upsertTradingProfile(row: {
  user_id: number;
  active_wallet_id?: number | null;
  ton_amount?: number | null;
  buy_limit_price?: number | null;
  sell_percent?: number | null;
  trade_mode?: 'buy' | 'sell' | null;
  last_token?: string | null;
}): Promise<TradingProfileRow> {
  const {
    user_id,
    active_wallet_id = null,
    ton_amount = null,
    buy_limit_price = null,
    sell_percent = null,
    trade_mode = null,
    last_token = null,
  } = row;
  const hasTradeModePatch = trade_mode === 'buy' || trade_mode === 'sell';
  const tradeModeValue: 'buy' | 'sell' = hasTradeModePatch ? trade_mode! : 'buy';
  const r = await pool.query(
    `INSERT INTO user_trading_profiles (user_id, active_wallet_id, ton_amount, buy_limit_price, sell_percent, trade_mode, last_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id)
     DO UPDATE SET
       active_wallet_id = COALESCE(EXCLUDED.active_wallet_id, user_trading_profiles.active_wallet_id),
       ton_amount = COALESCE(EXCLUDED.ton_amount, user_trading_profiles.ton_amount),
       buy_limit_price = COALESCE(EXCLUDED.buy_limit_price, user_trading_profiles.buy_limit_price),
       sell_percent = COALESCE(EXCLUDED.sell_percent, user_trading_profiles.sell_percent),
       trade_mode = CASE WHEN $8 THEN EXCLUDED.trade_mode ELSE user_trading_profiles.trade_mode END,
       last_token = COALESCE(EXCLUDED.last_token, user_trading_profiles.last_token),
       updated_at = NOW()
     RETURNING user_id, active_wallet_id, ton_amount::text, buy_limit_price::text, sell_percent::text, trade_mode, last_token, updated_at`,
    [user_id, active_wallet_id, ton_amount, buy_limit_price, sell_percent, tradeModeValue, last_token, hasTradeModePatch]
  );
  return r.rows[0] as TradingProfileRow;
}

export type SwapOrderRow = {
  id: number;
  user_id: number;
  wallet_id: number;
  token_address: string;
  direction: 'buy' | 'sell';
  ton_amount: string;
  limit_price: string | null;
  sell_percent: string | null;
  status: string;
  error: string | null;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertSwapOrder(row: {
  user_id: number;
  wallet_id: number;
  token_address: string;
  direction: 'buy' | 'sell';
  ton_amount: number;
  limit_price?: number | null;
  sell_percent?: number | null;
}): Promise<SwapOrderRow> {
  const r = await pool.query(
    `INSERT INTO swap_orders (user_id, wallet_id, token_address, direction, ton_amount, limit_price, sell_percent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, wallet_id, token_address, direction, ton_amount::text, limit_price::text, sell_percent::text,
               status, error, tx_hash, created_at, updated_at`,
    [
      row.user_id,
      row.wallet_id,
      row.token_address,
      row.direction,
      row.ton_amount,
      row.limit_price ?? null,
      row.sell_percent ?? null,
    ]
  );
  return r.rows[0] as SwapOrderRow;
}

export async function updateSwapOrderStatus(
  id: number,
  status: string,
  options: { error?: string | null; tx_hash?: string | null } = {}
): Promise<SwapOrderRow | null> {
  const { error = null, tx_hash = null } = options;
  const r = await pool.query(
    `UPDATE swap_orders
     SET status = $2,
         error = COALESCE($3, error),
         tx_hash = COALESCE($4, tx_hash),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, user_id, wallet_id, token_address, direction, ton_amount::text, limit_price::text, sell_percent::text,
               status, error, tx_hash, created_at, updated_at`,
    [id, status, error, tx_hash]
  );
  return (r.rows[0] as SwapOrderRow) || null;
}

export async function claimNextSwapOrder(): Promise<SwapOrderRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selection = await client.query<SwapOrderRow>(
      `SELECT id, user_id, wallet_id, token_address, direction,
              ton_amount::text, limit_price::text, sell_percent::text,
              status, error, tx_hash, created_at, updated_at
         FROM swap_orders
        WHERE status = 'queued'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    if (!selection.rowCount) {
      await client.query('COMMIT');
      return null;
    }
    const row = selection.rows[0];
    const updated = await client.query<SwapOrderRow>(
      `UPDATE swap_orders
          SET status = 'processing',
              error = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, user_id, wallet_id, token_address, direction,
                  ton_amount::text, limit_price::text, sell_percent::text,
                  status, error, tx_hash, created_at, updated_at`,
      [row.id]
    );
    await client.query('COMMIT');
    return updated.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
