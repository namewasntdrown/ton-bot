package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/qtosh1/ton-bot/services/go-backend/internal/apiapp"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := apiapp.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	server := apiapp.NewServer(cfg)
	if err := server.Start(ctx); err != nil {
		log.Fatalf("start server: %v", err)
	}
}
