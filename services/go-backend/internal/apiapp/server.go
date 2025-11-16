package apiapp

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/ton"
)

// Server handles HTTP requests for the API service.
type Server struct {
	cfg      Config
	app      *echo.Echo
	ton      *ton.Client
	httpPort string
}

// NewServer configures Echo routes and dependencies.
func NewServer(cfg Config) *Server {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Use(middleware.Recover())

	tonCfg := cfg.TonClient
	tonCfg.HTTPClient = &http.Client{Timeout: cfg.HTTPTimeout}
	s := &Server{
		cfg:      cfg,
		app:      e,
		ton:      ton.NewClient(tonCfg),
		httpPort: formatAddr(cfg.Host, cfg.Port),
	}
	s.registerRoutes()
	return s
}

// Start begins listening for HTTP requests.
func (s *Server) Start(ctx context.Context) error {
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.app.Shutdown(shutdownCtx)
	}()
	err := s.app.Start(s.httpPort)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *Server) registerRoutes() {
	s.app.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	s.app.POST("/prepare_tx", s.handlePrepareTx)
	s.app.POST("/broadcast", s.handleBroadcast)
}

type prepareTxRequest struct {
	To     string `json:"to"`
	Amount int64  `json:"amount"`
}

type unsignedPayload struct {
	To     string `json:"to"`
	Value  int64  `json:"value"`
	Fee    int64  `json:"fee"`
	Expire int64  `json:"expire"`
}

func (s *Server) handlePrepareTx(c echo.Context) error {
	var payload prepareTxRequest
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	if len(payload.To) < 3 || payload.Amount <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	resp := map[string]any{
		"unsigned_payload": unsignedPayload{
			To:     payload.To,
			Value:  payload.Amount,
			Fee:    1_000_000,
			Expire: 60,
		},
	}
	return c.JSON(http.StatusOK, resp)
}

type broadcastRequest struct {
	SignedTxBlob string `json:"signed_tx_blob"`
}

func (s *Server) handleBroadcast(c echo.Context) error {
	apiKey := strings.TrimSpace(c.Request().Header.Get("x-api-key"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(c.Request().Header.Get("X-API-Key"))
	}
	if apiKey != s.cfg.RelayerAPIKey {
		return echo.NewHTTPError(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}
	var payload broadcastRequest
	if err := c.Bind(&payload); err != nil || strings.TrimSpace(payload.SignedTxBlob) == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "bad_request")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), s.cfg.HTTPTimeout)
	defer cancel()
	if err := s.ton.BroadcastBoc(ctx, payload.SignedTxBlob); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, map[string]string{
			"error":  "Node RPC error",
			"detail": err.Error(),
		})
	}
	return c.JSON(http.StatusOK, map[string]any{"status": "sent"})
}

func formatAddr(host string, port int) string {
	return host + ":" + strconv.Itoa(port)
}
