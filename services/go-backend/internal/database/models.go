package database

import "time"

type Wallet struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Address   string    `json:"address"`
	CreatedAt time.Time `json:"created_at"`
}

type WalletSecret struct {
	ID                int64  `json:"id"`
	UserID            int64  `json:"user_id"`
	Address           string `json:"address"`
	EncryptedMnemonic string `json:"encrypted_mnemonic"`
}

type UserWalletRef struct {
	UserID  int64  `json:"user_id"`
	Address string `json:"address"`
}

type TradingProfile struct {
	UserID         int64     `json:"user_id"`
	ActiveWalletID *int64    `json:"active_wallet_id,omitempty"`
	TonAmount      *string   `json:"ton_amount,omitempty"`
	BuyLimitPrice  *string   `json:"buy_limit_price,omitempty"`
	SellPercent    *string   `json:"sell_percent,omitempty"`
	TradeMode      string    `json:"trade_mode"`
	LastToken      *string   `json:"last_token,omitempty"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type SwapOrder struct {
	ID           int64     `json:"id"`
	UserID       int64     `json:"user_id"`
	WalletID     int64     `json:"wallet_id"`
	TokenAddress string    `json:"token_address"`
	Direction    string    `json:"direction"`
	TonAmount    string    `json:"ton_amount"`
	LimitPrice   *string   `json:"limit_price,omitempty"`
	SellPercent  *string   `json:"sell_percent,omitempty"`
	Status       string    `json:"status"`
	Error        *string   `json:"error,omitempty"`
	TxHash       *string   `json:"tx_hash,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Position struct {
	ID            int64     `json:"id"`
	UserID        int64     `json:"user_id"`
	WalletID      int64     `json:"wallet_id"`
	TokenAddress  string    `json:"token_address"`
	TokenSymbol   *string   `json:"token_symbol,omitempty"`
	TokenName     *string   `json:"token_name,omitempty"`
	TokenImage    *string   `json:"token_image,omitempty"`
	Amount        string    `json:"amount"`
	InvestedTon   string    `json:"invested_ton"`
	IsHidden      bool      `json:"is_hidden"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	WalletAddress *string   `json:"wallet_address,omitempty"`
}
