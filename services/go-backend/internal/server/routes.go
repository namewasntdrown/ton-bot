package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/crypto"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/database"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/ton"
)

func (s *Server) registerRoutes() {
	if s.app == nil {
		return
	}
	e := s.app

	e.GET("/health", s.handleHealth)
	e.GET("/diag", s.handleDiag)

	e.GET("/wallets", s.handleListWallets)
	e.GET("/wallets/:id", s.handleGetWallet)
	e.POST("/wallets", s.handleCreateWallet)
	e.DELETE("/wallets/:id", s.handleDeleteWallet)
	e.GET("/wallets/:id/address", s.handleWalletAddressFormats)
	e.GET("/wallets/:id/balance", s.handleWalletBalance)
	e.GET("/wallets/:id/max_sendable", s.handleWalletMaxSendable)
	e.POST("/wallets/:id/seed", s.handleWalletSeed)
	e.GET("/swap_orders", s.handleSwapOrders)

	e.POST("/transfer", s.handleTransfer)

	e.GET("/trading/profile", s.handleTradingProfile)
	e.POST("/trading/profile", s.handleTradingProfileUpsert)

	e.POST("/swap", s.handleCreateSwapOrder)
	e.GET("/user_wallets", s.handleListAllUserWallets)

	e.GET("/positions", s.handleListPositions)
	e.POST("/positions/:id/hide", s.handleHidePosition)
}

func (s *Server) handleSwapOrders(c echo.Context) error {
	userID, err := parseInt64(c.QueryParam("user_id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}
	ctx := c.Request().Context()
	rows, err := s.opts.Store.ListSwapOrders(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	return c.JSON(http.StatusOK, rows)
}

func (s *Server) handleHealth(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDiag(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"endpoint":  s.opts.Config.TonEndpoint,
		"apiKeySet": s.opts.Config.TonAPIKey != "",
	})
}

func (s *Server) handleListWallets(c echo.Context) error {
	userID, err := parseInt64(c.QueryParam("user_id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id is required")
	}
	includeBalance := parseBoolFlag(c.QueryParam("with_balance")) || parseBoolFlag(c.QueryParam("include_balance"))
	ctx := c.Request().Context()
	rows, err := s.opts.Store.ListWalletsByUser(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load wallets")
	}
	resp := make([]map[string]any, 0, len(rows))
	for _, w := range rows {
		item := map[string]any{
			"id":         w.ID,
			"address":    w.Address,
			"created_at": w.CreatedAt,
		}
		if includeBalance && s.opts.TonClient != nil {
			if bal, err := s.fetchBalance(ctx, w.Address); err == nil && bal != nil {
				item["balance_nton"] = bal.Nano
				item["balance_ton"] = bal.Ton
				item["balance"] = bal.Nano
				item["balanceNton"] = bal.Nano
			}
		}
		resp = append(resp, item)
	}
	return c.JSON(http.StatusOK, resp)
}

func (s *Server) handleGetWallet(c echo.Context) error {
	id, err := parseInt64(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.GetWalletByID(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to fetch wallet")
	}
	if row == nil {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	return c.JSON(http.StatusOK, row)
}

func (s *Server) handleCreateWallet(c echo.Context) error {
	if len(s.opts.Config.MasterKey) != 32 {
		return echo.NewHTTPError(http.StatusInternalServerError, "server_misconfiguration")
	}
	var payload struct {
		UserID int64 `json:"user_id"`
	}
	if err := c.Bind(&payload); err != nil || payload.UserID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}
	ctx := c.Request().Context()
	count, err := s.opts.Store.CountWalletsByUser(ctx, payload.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to check wallet limit")
	}
	if count >= s.opts.Config.MaxWalletsPerUser {
		return echo.NewHTTPError(http.StatusBadRequest, "limit")
	}
	words, err := crypto.GenerateMnemonic(24)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "mnemonic_failed")
	}
	if s.opts.TonClient == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "ton_client_unavailable")
	}
	address, err := s.opts.TonClient.DeriveWalletAddress(words)
	if err != nil {
		if errors.Is(err, ton.ErrNotImplemented) {
			return echo.NewHTTPError(http.StatusNotImplemented, "derive_address_not_supported")
		}
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("derive_address_failed: %v", err))
	}
	enc, err := crypto.EncryptMnemonic(s.opts.Config.MasterKey, strings.Join(words, " "))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "encrypt_failed")
	}
	row, err := s.opts.Store.InsertWallet(ctx, payload.UserID, address, enc)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "insert_failed")
	}
	return c.JSON(http.StatusCreated, row)
}

func (s *Server) handleWalletAddressFormats(c echo.Context) error {
	id, err := parseInt64(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.GetWalletByID(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	if row == nil {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	return c.JSON(http.StatusOK, map[string]any{
		"id":             row.ID,
		"user_id":        row.UserID,
		"bounceable":     row.Address,
		"non_bounceable": row.Address,
	})
}

func (s *Server) handleWalletBalance(c echo.Context) error {
	if s.opts.TonClient == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "ton_client_unavailable")
	}
	id, err := parseInt64(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.GetWalletByID(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	if row == nil {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	bal, err := s.opts.TonClient.GetAccountBalance(ctx, row.Address)
	if err != nil {
		if errors.Is(err, ton.ErrNotImplemented) {
			return echo.NewHTTPError(http.StatusNotImplemented, "ton_balance_not_ready")
		}
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("ton_error: %v", err))
	}
	return c.JSON(http.StatusOK, map[string]any{
		"balance":  bal.Nano,
		"endpoint": s.opts.Config.TonEndpoint,
	})
}

func (s *Server) handleDeleteWallet(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}
	var payload struct {
		UserID int64 `json:"user_id"`
	}
	if err := c.Bind(&payload); err != nil || payload.UserID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	ctx := c.Request().Context()
	ok, err := s.opts.Store.DeleteWallet(ctx, id, payload.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "delete_failed")
	}
	if !ok {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	return c.JSON(http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleWalletMaxSendable(c echo.Context) error {
	if s.opts.TonClient == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "ton_client_unavailable")
	}
	id, err := parseInt64(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.GetWalletByID(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	if row == nil {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	est, err := s.opts.TonClient.EstimateMaxSendable(ctx, row.Address)
	if err != nil {
		if errors.Is(err, ton.ErrNotImplemented) {
			return echo.NewHTTPError(http.StatusNotImplemented, "ton_estimate_not_ready")
		}
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("ton_error: %v", err))
	}
	return c.JSON(http.StatusOK, est)
}

func (s *Server) handleWalletSeed(c echo.Context) error {
	if len(s.opts.Config.MasterKey) != 32 {
		return echo.NewHTTPError(http.StatusInternalServerError, "server_misconfiguration")
	}
	id, err := parseInt64(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}
	var payload struct {
		UserID  int64 `json:"user_id"`
		Confirm bool  `json:"confirm"`
	}
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	if !payload.Confirm {
		return echo.NewHTTPError(http.StatusBadRequest, "confirm_required")
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.GetWalletSecretByID(ctx, id)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	if row == nil || row.UserID != payload.UserID {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	mnemonic, err := crypto.DecryptMnemonic(s.opts.Config.MasterKey, row.EncryptedMnemonic)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "decrypt_failed")
	}
	return c.JSON(http.StatusOK, map[string]string{"mnemonic": mnemonic})
}

func (s *Server) handleTransfer(c echo.Context) error {
	if s.opts.TonClient == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "ton_client_unavailable")
	}
	if len(s.opts.Config.MasterKey) != 32 {
		return echo.NewHTTPError(http.StatusInternalServerError, "server_misconfiguration")
	}
	var payload struct {
		UserID    int64   `json:"user_id"`
		WalletID  int64   `json:"wallet_id"`
		To        string  `json:"to"`
		AmountTon float64 `json:"amount_ton"`
		Comment   *string `json:"comment"`
	}
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	if payload.UserID <= 0 || payload.WalletID <= 0 || payload.AmountTon <= 0 || len(strings.TrimSpace(payload.To)) < 3 {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.GetWalletSecretByID(ctx, payload.WalletID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	if row == nil || row.UserID != payload.UserID {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	mnemonic, err := crypto.DecryptMnemonic(s.opts.Config.MasterKey, row.EncryptedMnemonic)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "decrypt_failed")
	}
	comment := ""
	if payload.Comment != nil {
		comment = *payload.Comment
	}
	if err := s.opts.TonClient.Transfer(ctx, ton.TransferRequest{
		Mnemonic:  mnemonic,
		To:        payload.To,
		AmountTon: payload.AmountTon,
		Comment:   comment,
	}); err != nil {
		if errors.Is(err, ton.ErrNotImplemented) {
			return echo.NewHTTPError(http.StatusNotImplemented, "ton_transfer_not_ready")
		}
		if errors.Is(err, ton.ErrInvalidDestination) {
			return echo.NewHTTPError(http.StatusBadRequest, map[string]string{"error": "bad_to"})
		}
		if errors.Is(err, ton.ErrInsufficientBalance) {
			return echo.NewHTTPError(http.StatusBadRequest, map[string]string{"error": "insufficient"})
		}
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("ton_transfer_failed: %v", err))
	}
	return c.JSON(http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleTradingProfile(c echo.Context) error {
	userID, err := parseInt64(c.QueryParam("user_id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}
	ctx := c.Request().Context()
	profile, err := s.opts.Store.GetTradingProfile(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	wallets, err := s.opts.Store.ListWalletsByUser(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "wallets_failed")
	}
	items := make([]map[string]any, 0, len(wallets))
	for _, w := range wallets {
		it := map[string]any{
			"id":         w.ID,
			"address":    w.Address,
			"created_at": w.CreatedAt,
		}
		if s.opts.TonClient != nil {
			if bal, err := s.fetchBalance(ctx, w.Address); err == nil && bal != nil {
				it["balance_nton"] = bal.Nano
				it["balance_ton"] = bal.Ton
			}
		}
		items = append(items, it)
	}
	return c.JSON(http.StatusOK, map[string]any{
		"profile": profile,
		"wallets": items,
	})
}

func (s *Server) handleTradingProfileUpsert(c echo.Context) error {
	var payload struct {
		UserID         int64    `json:"user_id"`
		ActiveWalletID *int64   `json:"active_wallet_id"`
		TonAmount      *float64 `json:"ton_amount"`
		BuyLimitPrice  *float64 `json:"buy_limit_price"`
		SellPercent    *float64 `json:"sell_percent"`
		TradeMode      *string  `json:"trade_mode"`
		LastToken      *string  `json:"last_token"`
	}
	if err := c.Bind(&payload); err != nil || payload.UserID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	if payload.ActiveWalletID != nil {
		ctx := c.Request().Context()
		row, err := s.opts.Store.GetWalletByID(ctx, *payload.ActiveWalletID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
		}
		if row == nil || row.UserID != payload.UserID {
			return echo.NewHTTPError(http.StatusNotFound, "wallet_not_found")
		}
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.UpsertTradingProfile(ctx, database.TradingProfileUpdate{
		UserID:         payload.UserID,
		ActiveWalletID: payload.ActiveWalletID,
		TonAmount:      payload.TonAmount,
		BuyLimitPrice:  payload.BuyLimitPrice,
		SellPercent:    payload.SellPercent,
		TradeMode:      sanitizeTradeMode(payload.TradeMode),
		LastToken:      payload.LastToken,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "upsert_failed")
	}
	return c.JSON(http.StatusOK, row)
}

func (s *Server) handleCreateSwapOrder(c echo.Context) error {
	var payload struct {
		UserID       int64    `json:"user_id"`
		WalletID     int64    `json:"wallet_id"`
		TokenAddress string   `json:"token_address"`
		Direction    string   `json:"direction"`
		TonAmount    float64  `json:"ton_amount"`
		LimitPrice   *float64 `json:"limit_price"`
		SellPercent  *float64 `json:"sell_percent"`
		PositionHint *struct {
			TokenAmount   float64  `json:"token_amount"`
			TokenPriceTon *float64 `json:"token_price_ton"`
			TokenPriceUsd *float64 `json:"token_price_usd"`
			TokenSymbol   *string  `json:"token_symbol"`
			TokenName     *string  `json:"token_name"`
			TokenImage    *string  `json:"token_image"`
		} `json:"position_hint"`
	}
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	if payload.UserID <= 0 || payload.WalletID <= 0 || payload.TonAmount <= 0 || len(payload.TokenAddress) < 10 {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	dir := strings.ToLower(payload.Direction)
	if dir != "buy" && dir != "sell" {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	ctx := c.Request().Context()
	wallet, err := s.opts.Store.GetWalletByID(ctx, payload.WalletID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	if wallet == nil || wallet.UserID != payload.UserID {
		return echo.NewHTTPError(http.StatusNotFound, "wallet_not_found")
	}
	order, err := s.opts.Store.InsertSwapOrder(ctx, database.InsertSwapOrderParams{
		UserID:       payload.UserID,
		WalletID:     payload.WalletID,
		TokenAddress: payload.TokenAddress,
		Direction:    dir,
		TonAmount:    payload.TonAmount,
		LimitPrice:   payload.LimitPrice,
		SellPercent:  payload.SellPercent,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "insert_failed")
	}
	if dir == "buy" && payload.PositionHint != nil && payload.PositionHint.TokenAmount > 0 {
		_, upsertErr := s.opts.Store.UpsertUserPosition(ctx, database.UpsertUserPositionParams{
			UserID:       payload.UserID,
			WalletID:     payload.WalletID,
			TokenAddress: payload.TokenAddress,
			TokenSymbol:  payload.PositionHint.TokenSymbol,
			TokenName:    payload.PositionHint.TokenName,
			TokenImage:   payload.PositionHint.TokenImage,
			Amount:       payload.PositionHint.TokenAmount,
			InvestedTon:  payload.TonAmount,
		})
		if upsertErr != nil {
			c.Logger().Errorf("position upsert failed: %v", upsertErr)
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"order": order})
}

func (s *Server) handleListAllUserWallets(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := s.opts.Store.ListAllUserWallets(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	return c.JSON(http.StatusOK, rows)
}

func (s *Server) handleListPositions(c echo.Context) error {
	userID, err := parseInt64(c.QueryParam("user_id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}
	includeHidden := parseBoolFlag(c.QueryParam("include_hidden"))
	ctx := c.Request().Context()
	rows, err := s.opts.Store.ListUserPositions(ctx, userID, includeHidden)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "fetch_failed")
	}
	return c.JSON(http.StatusOK, rows)
}

func (s *Server) handleHidePosition(c echo.Context) error {
	positionID, err := parseInt64(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}
	var payload struct {
		UserID int64 `json:"user_id"`
		Hidden *bool `json:"hidden"`
	}
	if err := c.Bind(&payload); err != nil || payload.UserID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	hidden := true
	if payload.Hidden != nil {
		hidden = *payload.Hidden
	}
	ctx := c.Request().Context()
	row, err := s.opts.Store.SetUserPositionHidden(ctx, payload.UserID, positionID, hidden)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "update_failed")
	}
	if row == nil {
		return echo.NewHTTPError(http.StatusNotFound, "not_found")
	}
	return c.JSON(http.StatusOK, row)
}

func (s *Server) fetchBalance(ctx context.Context, address string) (*ton.Balance, error) {
	if s.opts.TonClient == nil {
		return nil, errors.New("ton client unavailable")
	}
	return s.opts.TonClient.GetAccountBalance(ctx, address)
}

func parseInt64(value string) (int64, error) {
	v := strings.TrimSpace(value)
	if v == "" {
		return 0, errors.New("empty")
	}
	return strconv.ParseInt(v, 10, 64)
}

func parseBoolFlag(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "yes", "on":
		return true
	default:
		return false
	}
}

func sanitizeTradeMode(mode *string) *string {
	if mode == nil {
		return nil
	}
	m := strings.ToLower(strings.TrimSpace(*mode))
	if m != "buy" && m != "sell" {
		return nil
	}
	return &m
}
