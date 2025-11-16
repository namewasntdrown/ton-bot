package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s *Store) ListWalletsByUser(ctx context.Context, userID int64) ([]Wallet, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, user_id, address, created_at FROM wallets WHERE user_id = $1 ORDER BY id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Wallet, 0)
	for rows.Next() {
		var w Wallet
		if err := rows.Scan(&w.ID, &w.UserID, &w.Address, &w.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

func (s *Store) CountWalletsByUser(ctx context.Context, userID int64) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM wallets WHERE user_id = $1`, userID).Scan(&count)
	return count, err
}

func (s *Store) InsertWallet(ctx context.Context, userID int64, address, encryptedMnemonic string) (Wallet, error) {
	var w Wallet
	err := s.pool.QueryRow(ctx, `INSERT INTO wallets (user_id, address, encrypted_mnemonic)
		VALUES ($1,$2,$3)
		RETURNING id, user_id, address, created_at`,
		userID, address, encryptedMnemonic,
	).Scan(&w.ID, &w.UserID, &w.Address, &w.CreatedAt)
	return w, err
}

func (s *Store) GetWalletByID(ctx context.Context, id int64) (*Wallet, error) {
	var w Wallet
	err := s.pool.QueryRow(ctx, `SELECT id, user_id, address, created_at FROM wallets WHERE id = $1`, id).
		Scan(&w.ID, &w.UserID, &w.Address, &w.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &w, err
}

func (s *Store) GetWalletSecretByID(ctx context.Context, id int64) (*WalletSecret, error) {
	var w WalletSecret
	err := s.pool.QueryRow(ctx, `SELECT id, user_id, address, encrypted_mnemonic FROM wallets WHERE id = $1`, id).
		Scan(&w.ID, &w.UserID, &w.Address, &w.EncryptedMnemonic)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &w, err
}

func (s *Store) DeleteWallet(ctx context.Context, id, userID int64) (bool, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM wallets WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) ListAllUserWallets(ctx context.Context) ([]UserWalletRef, error) {
	rows, err := s.pool.Query(ctx, `SELECT user_id, address FROM wallets ORDER BY user_id ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var wallets []UserWalletRef
	for rows.Next() {
		var ref UserWalletRef
		if err := rows.Scan(&ref.UserID, &ref.Address); err != nil {
			return nil, err
		}
		wallets = append(wallets, ref)
	}
	return wallets, rows.Err()
}

func (s *Store) GetTradingProfile(ctx context.Context, userID int64) (*TradingProfile, error) {
	var row TradingProfile
	var tonAmount, buyLimit, sellPercent, lastToken sql.NullString
	var activeWalletID sql.NullInt64
	err := s.pool.QueryRow(ctx, `SELECT user_id, active_wallet_id, ton_amount::text, buy_limit_price::text,
		sell_percent::text, trade_mode, last_token, updated_at
		FROM user_trading_profiles WHERE user_id = $1`, userID).
		Scan(&row.UserID, &activeWalletID, &tonAmount, &buyLimit, &sellPercent, &row.TradeMode, &lastToken, &row.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	row.ActiveWalletID = nullableInt(activeWalletID)
	row.TonAmount = nullableString(tonAmount)
	row.BuyLimitPrice = nullableString(buyLimit)
	row.SellPercent = nullableString(sellPercent)
	row.LastToken = nullableString(lastToken)
	return &row, err
}

func (s *Store) UpsertTradingProfile(ctx context.Context, payload TradingProfileUpdate) (*TradingProfile, error) {
	hasTradeMode := payload.TradeMode != nil && (*payload.TradeMode == "buy" || *payload.TradeMode == "sell")
	tradeMode := "buy"
	if hasTradeMode {
		tradeMode = *payload.TradeMode
	}

	var row TradingProfile
	var tonAmount, buyLimit, sellPercent, lastToken sql.NullString
	var activeWalletID sql.NullInt64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO user_trading_profiles (user_id, active_wallet_id, ton_amount, buy_limit_price, sell_percent, trade_mode, last_token)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (user_id)
		DO UPDATE SET
			active_wallet_id = COALESCE(EXCLUDED.active_wallet_id, user_trading_profiles.active_wallet_id),
			ton_amount = COALESCE(EXCLUDED.ton_amount, user_trading_profiles.ton_amount),
			buy_limit_price = COALESCE(EXCLUDED.buy_limit_price, user_trading_profiles.buy_limit_price),
			sell_percent = COALESCE(EXCLUDED.sell_percent, user_trading_profiles.sell_percent),
			trade_mode = CASE WHEN $8 THEN EXCLUDED.trade_mode ELSE user_trading_profiles.trade_mode END,
			last_token = COALESCE(EXCLUDED.last_token, user_trading_profiles.last_token),
			updated_at = NOW()
		RETURNING user_id, active_wallet_id, ton_amount::text, buy_limit_price::text,
		          sell_percent::text, trade_mode, last_token, updated_at
	`, payload.UserID, optionalInt64(payload.ActiveWalletID), optionalFloat(payload.TonAmount), optionalFloat(payload.BuyLimitPrice), optionalFloat(payload.SellPercent), tradeMode, optionalString(payload.LastToken), hasTradeMode).
		Scan(&row.UserID, &activeWalletID, &tonAmount, &buyLimit, &sellPercent, &row.TradeMode, &lastToken, &row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	row.ActiveWalletID = nullableInt(activeWalletID)
	row.TonAmount = nullableString(tonAmount)
	row.BuyLimitPrice = nullableString(buyLimit)
	row.SellPercent = nullableString(sellPercent)
	row.LastToken = nullableString(lastToken)
	return &row, nil
}

func (s *Store) InsertSwapOrder(ctx context.Context, input InsertSwapOrderParams) (*SwapOrder, error) {
	var ord SwapOrder
	var limitPrice, sellPercent, errMsg, txHash sql.NullString
	err := s.pool.QueryRow(ctx, `
		INSERT INTO swap_orders (user_id, wallet_id, token_address, direction, ton_amount, limit_price, sell_percent)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, user_id, wallet_id, token_address, direction,
		          ton_amount::text, limit_price::text, sell_percent::text,
		          status, error, tx_hash, created_at, updated_at
	`, input.UserID, input.WalletID, input.TokenAddress, input.Direction, input.TonAmount, optionalFloat(input.LimitPrice), optionalFloat(input.SellPercent)).
		Scan(&ord.ID, &ord.UserID, &ord.WalletID, &ord.TokenAddress, &ord.Direction,
			&ord.TonAmount, &limitPrice, &sellPercent, &ord.Status, &errMsg, &txHash, &ord.CreatedAt, &ord.UpdatedAt)
	if err != nil {
		return nil, err
	}
	ord.LimitPrice = nullableString(limitPrice)
	ord.SellPercent = nullableString(sellPercent)
	ord.Error = nullableString(errMsg)
	ord.TxHash = nullableString(txHash)
	return &ord, nil
}

func (s *Store) UpdateSwapOrderStatus(ctx context.Context, id int64, status string, opts UpdateSwapOrderOptions) (*SwapOrder, error) {
	var ord SwapOrder
	var limitPrice, sellPercent, errMsg, txHash sql.NullString
	err := s.pool.QueryRow(ctx, `
		UPDATE swap_orders SET
			status = $2,
			error = COALESCE($3, error),
			tx_hash = COALESCE($4, tx_hash),
			updated_at = NOW()
		WHERE id = $1
		RETURNING id, user_id, wallet_id, token_address, direction,
		          ton_amount::text, limit_price::text, sell_percent::text,
		          status, error, tx_hash, created_at, updated_at
	`, id, status, opts.Error, opts.TxHash).
		Scan(&ord.ID, &ord.UserID, &ord.WalletID, &ord.TokenAddress, &ord.Direction,
			&ord.TonAmount, &limitPrice, &sellPercent, &ord.Status, &errMsg, &txHash, &ord.CreatedAt, &ord.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	ord.LimitPrice = nullableString(limitPrice)
	ord.SellPercent = nullableString(sellPercent)
	ord.Error = nullableString(errMsg)
	ord.TxHash = nullableString(txHash)
	return &ord, nil
}

func (s *Store) ClaimNextSwapOrder(ctx context.Context) (*SwapOrder, error) {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var ord SwapOrder
	var limitPrice, sellPercent, errMsg, txHash sql.NullString
	row := tx.QueryRow(ctx, `
		SELECT id, user_id, wallet_id, token_address, direction,
		       ton_amount::text, limit_price::text, sell_percent::text,
		       status, error, tx_hash, created_at, updated_at
		  FROM swap_orders
		 WHERE status = 'queued'
		 ORDER BY created_at ASC
		 FOR UPDATE SKIP LOCKED
		 LIMIT 1`)
	if err := row.Scan(&ord.ID, &ord.UserID, &ord.WalletID, &ord.TokenAddress, &ord.Direction,
		&ord.TonAmount, &limitPrice, &sellPercent, &ord.Status, &errMsg, &txHash, &ord.CreatedAt, &ord.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if err := tx.Rollback(ctx); err != nil {
				return nil, err
			}
			return nil, nil
		}
		return nil, err
	}

	if err := tx.QueryRow(ctx, `
		UPDATE swap_orders
		   SET status = 'processing',
		       error = NULL,
		       updated_at = NOW()
		 WHERE id = $1
		 RETURNING id, user_id, wallet_id, token_address, direction,
		       ton_amount::text, limit_price::text, sell_percent::text,
		       status, error, tx_hash, created_at, updated_at`,
		ord.ID).
		Scan(&ord.ID, &ord.UserID, &ord.WalletID, &ord.TokenAddress, &ord.Direction,
			&ord.TonAmount, &limitPrice, &sellPercent, &ord.Status, &errMsg, &txHash, &ord.CreatedAt, &ord.UpdatedAt); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	ord.LimitPrice = nullableString(limitPrice)
	ord.SellPercent = nullableString(sellPercent)
	ord.Error = nullableString(errMsg)
	ord.TxHash = nullableString(txHash)
	return &ord, nil
}

func (s *Store) UpsertUserPosition(ctx context.Context, input UpsertUserPositionParams) (*Position, error) {
	var pos Position
	var tokenSymbol, tokenName, tokenImage sql.NullString
	err := s.pool.QueryRow(ctx, `
		INSERT INTO user_positions (user_id, wallet_id, token_address, token_symbol, token_name, token_image, amount, invested_ton)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (user_id, wallet_id, token_address)
		DO UPDATE SET
			amount = user_positions.amount + EXCLUDED.amount,
			invested_ton = user_positions.invested_ton + EXCLUDED.invested_ton,
			token_symbol = COALESCE(EXCLUDED.token_symbol, user_positions.token_symbol),
			token_name = COALESCE(EXCLUDED.token_name, user_positions.token_name),
			token_image = COALESCE(EXCLUDED.token_image, user_positions.token_image),
			is_hidden = FALSE,
			updated_at = NOW()
		RETURNING id, user_id, wallet_id, token_address, token_symbol, token_name, token_image,
		          amount::text, invested_ton::text, is_hidden, created_at, updated_at
	`, input.UserID, input.WalletID, input.TokenAddress, optionalString(input.TokenSymbol), optionalString(input.TokenName), optionalString(input.TokenImage), input.Amount, input.InvestedTon).
		Scan(&pos.ID, &pos.UserID, &pos.WalletID, &pos.TokenAddress, &tokenSymbol, &tokenName, &tokenImage,
			&pos.Amount, &pos.InvestedTon, &pos.IsHidden, &pos.CreatedAt, &pos.UpdatedAt)
	if err != nil {
		return nil, err
	}
	pos.TokenSymbol = nullableString(tokenSymbol)
	pos.TokenName = nullableString(tokenName)
	pos.TokenImage = nullableString(tokenImage)
	return &pos, nil
}

func (s *Store) ListUserPositions(ctx context.Context, userID int64, includeHidden bool) ([]Position, error) {
	filter := ""
	if !includeHidden {
		filter = "AND p.is_hidden = FALSE"
	}
	query := fmt.Sprintf(`
		SELECT p.id, p.user_id, p.wallet_id, p.token_address, p.token_symbol, p.token_name, p.token_image,
		       p.amount::text, p.invested_ton::text, p.is_hidden, p.created_at, p.updated_at,
		       w.address AS wallet_address
		  FROM user_positions p
		  JOIN wallets w ON w.id = p.wallet_id
		 WHERE p.user_id = $1
		   %s
		 ORDER BY p.updated_at DESC
	`, filter)

	rows, err := s.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []Position
	for rows.Next() {
		var pos Position
		var tokenSymbol, tokenName, tokenImage, walletAddr sql.NullString
		if err := rows.Scan(&pos.ID, &pos.UserID, &pos.WalletID, &pos.TokenAddress, &tokenSymbol, &tokenName, &tokenImage,
			&pos.Amount, &pos.InvestedTon, &pos.IsHidden, &pos.CreatedAt, &pos.UpdatedAt, &walletAddr); err != nil {
			return nil, err
		}
		pos.TokenSymbol = nullableString(tokenSymbol)
		pos.TokenName = nullableString(tokenName)
		pos.TokenImage = nullableString(tokenImage)
		pos.WalletAddress = nullableString(walletAddr)
		positions = append(positions, pos)
	}
	return positions, rows.Err()
}

func (s *Store) SetUserPositionHidden(ctx context.Context, userID, positionID int64, hidden bool) (*Position, error) {
	var pos Position
	var tokenSymbol, tokenName, tokenImage sql.NullString
	err := s.pool.QueryRow(ctx, `
		UPDATE user_positions
		   SET is_hidden = $3,
		       updated_at = NOW()
		 WHERE id = $1 AND user_id = $2
		 RETURNING id, user_id, wallet_id, token_address, token_symbol, token_name, token_image,
		       amount::text, invested_ton::text, is_hidden, created_at, updated_at
	`, positionID, userID, hidden).
		Scan(&pos.ID, &pos.UserID, &pos.WalletID, &pos.TokenAddress, &tokenSymbol, &tokenName, &tokenImage,
			&pos.Amount, &pos.InvestedTon, &pos.IsHidden, &pos.CreatedAt, &pos.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	pos.TokenSymbol = nullableString(tokenSymbol)
	pos.TokenName = nullableString(tokenName)
	pos.TokenImage = nullableString(tokenImage)
	return &pos, nil
}

func (s *Store) ListSwapOrders(ctx context.Context, userID int64) ([]SwapOrder, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, wallet_id, token_address, direction,
		       ton_amount::text, limit_price::text, sell_percent::text,
		       status, error, tx_hash, created_at, updated_at
		  FROM swap_orders
		 WHERE user_id = $1
		 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []SwapOrder
	for rows.Next() {
		var ord SwapOrder
		var limitPrice, sellPercent, errMsg, txHash sql.NullString
		if err := rows.Scan(&ord.ID, &ord.UserID, &ord.WalletID, &ord.TokenAddress, &ord.Direction,
			&ord.TonAmount, &limitPrice, &sellPercent, &ord.Status, &errMsg, &txHash, &ord.CreatedAt, &ord.UpdatedAt); err != nil {
			return nil, err
		}
		ord.LimitPrice = nullableString(limitPrice)
		ord.SellPercent = nullableString(sellPercent)
		ord.Error = nullableString(errMsg)
		ord.TxHash = nullableString(txHash)
		items = append(items, ord)
	}
	return items, rows.Err()
}

// TradingProfileUpdate describes the upsert payload.
type TradingProfileUpdate struct {
	UserID         int64
	ActiveWalletID *int64
	TonAmount      *float64
	BuyLimitPrice  *float64
	SellPercent    *float64
	TradeMode      *string
	LastToken      *string
}

// InsertSwapOrderParams stores swap order input data.
type InsertSwapOrderParams struct {
	UserID       int64
	WalletID     int64
	TokenAddress string
	Direction    string
	TonAmount    float64
	LimitPrice   *float64
	SellPercent  *float64
}

// UpdateSwapOrderOptions allows optional error / tx overrides.
type UpdateSwapOrderOptions struct {
	Error  *string
	TxHash *string
}

// UpsertUserPositionParams holds position metrics.
type UpsertUserPositionParams struct {
	UserID       int64
	WalletID     int64
	TokenAddress string
	TokenSymbol  *string
	TokenName    *string
	TokenImage   *string
	Amount       float64
	InvestedTon  float64
}

func nullableString(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	str := ns.String
	return &str
}

func nullableInt(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	val := n.Int64
	return &val
}

func optionalString(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

func optionalFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func optionalInt64(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}
