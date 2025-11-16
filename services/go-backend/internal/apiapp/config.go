package apiapp

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/qtosh1/ton-bot/services/go-backend/internal/ton"
)

// Config holds runtime settings for the API service.
type Config struct {
	Host          string
	Port          int
	RelayerAPIKey string
	TonClient     ton.Config
	HTTPTimeout   time.Duration
}

// LoadConfig reads environment variables and constructs Config.
func LoadConfig() (Config, error) {
	cfg := Config{
		Host:        getEnv("HOST", "0.0.0.0"),
		Port:        getEnvInt("PORT", 8080),
		HTTPTimeout: getEnvDuration("HTTP_TIMEOUT", 10*time.Second),
		RelayerAPIKey: strings.TrimSpace(
			getEnv("RELAYER_API_KEY", "dev-relayer-key"),
		),
		TonClient: ton.Config{
			Endpoint: strings.TrimSpace(
				getEnv("TON_RPC_ENDPOINT", "https://testnet.toncenter.com/api/v2/jsonRPC"),
			),
			APIKey: strings.TrimSpace(os.Getenv("TONCENTER_API_KEY")),
		},
	}
	if cfg.TonClient.Endpoint == "" {
		return cfg, fmt.Errorf("TON_RPC_ENDPOINT must be set")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if val := strings.TrimSpace(os.Getenv(key)); val != "" {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val := strings.TrimSpace(os.Getenv(key)); val != "" {
		if parsed, err := strconv.Atoi(val); err == nil {
			return parsed
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if val := strings.TrimSpace(os.Getenv(key)); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return fallback
}
