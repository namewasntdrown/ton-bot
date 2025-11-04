import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function migrate() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      created_at timestamptz not null default now()
    );
    create table if not exists wallets (
      id bigserial primary key,
      user_id text not null references users(id) on delete cascade,
      address text not null,
      ciphertext text not null,
      iv text not null,
      tag text not null,
      salt text not null,
      enc_record_key text not null,
      kdf text not null,
      alg text not null,
      created_at timestamptz not null default now()
    );
    create unique index if not exists wallets_user_id_idx on wallets(user_id);
  `);
}

export async function getWalletByUser(userId: string) {
  const r = await pool.query(`select * from wallets where user_id = $1 limit 1`, [userId]);
  return r.rows[0] || null;
}

export async function ensureUser(userId: string) {
  await pool.query(`insert into users(id) values($1) on conflict (id) do nothing`, [userId]);
}

export async function insertWallet(row: {
  user_id: string;
  address: string;
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
  enc_record_key: string;
  kdf: string;
  alg: string;
}) {
  await pool.query(
    `insert into wallets (user_id,address,ciphertext,iv,tag,salt,enc_record_key,kdf,alg)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.user_id,
      row.address,
      row.ciphertext,
      row.iv,
      row.tag,
      row.salt,
      row.enc_record_key,
      row.kdf,
      row.alg,
    ]
  );
}
