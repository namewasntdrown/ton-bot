package watcher

import (
    "time"

    "github.com/caarlos0/env/v10"
)

type Config struct {
    WalletAPIBase        string        `env:"WALLET_API_BASE" envDefault:"http://localhost:8090"`
    TonAPIBase           string        `env:"TON_API_BASE" envDefault:"https://tonapi.io"`
    TonAPIKey            string        `env:"TON_API_KEY"`
    PollInterval         time.Duration `env:"WATCHER_POLL_INTERVAL" envDefault:"15s"`
    SourceRefreshInterval time.Duration `env:"WATCHER_SOURCE_REFRESH" envDefault:"1m"`
    HTTPTimeout          time.Duration `env:"WATCHER_HTTP_TIMEOUT" envDefault:"10s"`
}

func LoadConfig() (Config, error) {
    var cfg Config
    if err := env.Parse(&cfg); err != nil {
        return cfg, err
    }
    return cfg, nil
}
