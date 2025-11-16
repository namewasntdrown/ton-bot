package config

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config aggregates runtime configuration loaded from environment variables.
type Config struct {
	HTTPHost          string
	HTTPPort          int
	DatabaseURL       string
	MasterKey         []byte
	TonEndpoint       string
	TonAPIKey         string
	DedustAPIBase     string
	MaxWalletsPerUser int
	ShutdownTimeout   time.Duration
	EnableGoRelayer   bool
}

// Load parses environment variables and produces a Config struct.
func Load() (Config, error) {
	cfg := Config{
		HTTPHost:          getEnv("HOST", "0.0.0.0"),
		HTTPPort:          getEnvInt("PORT", 8090),
		TonEndpoint:       getEnv("TON_RPC_ENDPOINT", "https://toncenter.com/api/v2/jsonRPC"),
		TonAPIKey:         os.Getenv("TONCENTER_API_KEY"),
		DedustAPIBase:     os.Getenv("DEDUST_API_BASE_URL"),
		MaxWalletsPerUser: getEnvInt("WALLET_LIMIT_PER_USER", 3),
		ShutdownTimeout:   getEnvDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
		EnableGoRelayer:   getEnvBool("ENABLE_GO_RELAYER", false),
	}

	if raw := strings.TrimSpace(os.Getenv("MASTER_KEY_DEV")); raw != "" {
		key, err := decodeMasterKey(raw)
		if err != nil {
			return cfg, fmt.Errorf("decode master key: %w", err)
		}
		cfg.MasterKey = key
	}

	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		cfg.DatabaseURL = dsn
	} else {
		var (
			host = os.Getenv("PGHOST")
			user = os.Getenv("PGUSER")
			pass = os.Getenv("PGPASSWORD")
			name = os.Getenv("PGDATABASE")
		)
		port := getEnvInt("PGPORT", 5432)
		if host == "" || user == "" || pass == "" || name == "" {
			return cfg, errors.New("DATABASE_URL or PG* variables must be provided")
		}
		u := &url.URL{
			Scheme: "postgres",
			User:   url.UserPassword(user, pass),
			Host:   fmt.Sprintf("%s:%d", host, port),
			Path:   name,
		}
		cfg.DatabaseURL = u.String()
	}

	if cfg.DatabaseURL == "" {
		return cfg, errors.New("database connection string is empty")
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
		if parsed, err := time.ParseDuration(val); err == nil {
			return parsed
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if val := strings.TrimSpace(os.Getenv(key)); val != "" {
		switch strings.ToLower(val) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return fallback
}

func decodeMasterKey(raw string) ([]byte, error) {
	switch {
	case strings.HasPrefix(raw, "base64:"):
		return base64.StdEncoding.DecodeString(raw[7:])
	case strings.HasPrefix(raw, "hex:"):
		return hex.DecodeString(raw[4:])
	default:
		// Treat as base64 by default for compatibility with the TS implementation.
		return base64.StdEncoding.DecodeString(raw)
	}
}
