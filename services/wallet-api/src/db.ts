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
