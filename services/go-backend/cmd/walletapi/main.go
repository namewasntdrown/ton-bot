package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/qtosh1/ton-bot/services/go-backend/internal/config"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/database"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/relayer"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/server"
	"github.com/qtosh1/ton-bot/services/go-backend/internal/ton"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	store, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer store.Close()

	if err := store.Migrate(ctx); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}

	tonClient := ton.NewClient(ton.Config{
		Endpoint: cfg.TonEndpoint,
		APIKey:   cfg.TonAPIKey,
	})

	srv := server.New(server.Options{
		Config:    cfg,
		Store:     store,
		TonClient: tonClient,
	})

	var swapRelayer *relayer.SwapRelayer
	if cfg.EnableGoRelayer && len(cfg.MasterKey) == 32 {
		swapRelayer = relayer.New(relayer.Options{
			Store:     store,
			Logger:    log.Default(),
			MasterKey: cfg.MasterKey,
		})
		swapRelayer.Start(ctx)
	} else if cfg.EnableGoRelayer {
		log.Println("ENABLE_GO_RELAYER set but MASTER_KEY_DEV missing or invalid length")
	}

	if err := srv.Start(ctx); err != nil {
		log.Fatalf("start HTTP server: %v", err)
	}

	<-ctx.Done()
	if swapRelayer != nil {
		swapRelayer.Stop()
	}
	if err := srv.Shutdown(context.Background()); err != nil {
		log.Printf("server shutdown: %v", err)
	}
}
