package main

import (
    "context"
    "log"
    "os"
    "os/signal"
    "syscall"

    "github.com/qtosh1/ton-bot/services/go-bot/internal/watcher"
)

func main() {
    cfg, err := watcher.LoadConfig()
    if err != nil {
        log.Fatalf("load config: %v", err)
    }
    svc := watcher.NewWatcher(cfg)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    go func() {
        sigCh := make(chan os.Signal, 1)
        signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
        <-sigCh
        cancel()
    }()

    if err := svc.Run(ctx); err != nil && err != context.Canceled {
        log.Fatalf("watcher stopped: %v", err)
    }
}
