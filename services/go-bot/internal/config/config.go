package config

import (
	"time"

	"github.com/caarlos0/env/v10"
)

// Config holds bot configuration.
type Config struct {
	TelegramToken string        `env:"BOT_TOKEN,required"`
	WalletAPIBase string        `env:"WALLET_API_BASE" envDefault:"http://localhost:8090"`
	HTTPTimeout   time.Duration `env:"HTTP_TIMEOUT" envDefault:"10s"`
}

func Load() (Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}
