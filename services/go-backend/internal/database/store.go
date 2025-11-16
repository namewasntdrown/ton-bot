package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store wraps a pgx connection pool and exposes data helpers.
type Store struct {
	pool *pgxpool.Pool
}

// New opens a pgx pool using the provided DSN.
func New(ctx context.Context, dsn string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse pool config: %w", err)
	}
	cfg.MinConns = 1
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases all database resources.
func (s *Store) Close() {
	if s == nil || s.pool == nil {
		return
	}
	s.pool.Close()
}

// Pool exposes the underlying pgx pool.
func (s *Store) Pool() *pgxpool.Pool {
	return s.pool
}

// Migrate ensures that all required tables exist.
func (s *Store) Migrate(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("store not initialized")
	}
	_, err := s.pool.Exec(ctx, migrationSQL)
	return err
}

const migrationSQL = `
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

ALTER TABLE user_trading_profiles
  ADD COLUMN IF NOT EXISTS ton_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS buy_limit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS sell_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS trade_mode TEXT NOT NULL DEFAULT 'buy',
  ADD COLUMN IF NOT EXISTS last_token TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE user_trading_profiles SET trade_mode = 'buy' WHERE trade_mode IS NULL;
ALTER TABLE user_trading_profiles ALTER COLUMN trade_mode SET DEFAULT 'buy';
ALTER TABLE user_trading_profiles ALTER COLUMN trade_mode SET NOT NULL;

CREATE TABLE IF NOT EXISTS swap_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token_address TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('buy','sell')),
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

ALTER TABLE swap_orders
  ADD COLUMN IF NOT EXISTS limit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS sell_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS user_positions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  token_name TEXT,
  token_image TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  invested_ton NUMERIC NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, wallet_id, token_address)
);
CREATE INDEX IF NOT EXISTS idx_positions_user ON user_positions(user_id);
`
