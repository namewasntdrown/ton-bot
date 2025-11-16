package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/config"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/database"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/ton"
)

// TonService captures the Ton-related operations required by the HTTP layer.
type TonService interface {
	Ping(ctx context.Context) error
	GetAccountBalance(ctx context.Context, address string) (*ton.Balance, error)
	EstimateMaxSendable(ctx context.Context, address string) (*ton.MaxSendable, error)
	DeriveWalletAddress(words []string) (string, error)
	Transfer(ctx context.Context, req ton.TransferRequest) error
}

// Options configures the HTTP server instance.
type Options struct {
	Config    config.Config
	Store     *database.Store
	TonClient TonService
}

// Server wires Echo with the application dependencies.
type Server struct {
	opts Options
	app  *echo.Echo
}

// New creates a new Server instance.
func New(opts Options) *Server {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Use(middleware.Recover())

	s := &Server{
		opts: opts,
		app:  e,
	}
	s.registerRoutes()
	return s
}

// Start launches the HTTP server and blocks until it stops.
func (s *Server) Start(ctx context.Context) error {
	addr := fmt.Sprintf("%s:%d", s.opts.Config.HTTPHost, s.opts.Config.HTTPPort)

	go func() {
		<-ctx.Done()
		_ = s.Shutdown(context.Background())
	}()

	err := s.app.Start(addr)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Shutdown stops the HTTP server gracefully.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.app == nil {
		return nil
	}
	return s.app.Shutdown(ctx)
}
