package main

import (
	"log"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"

	"github.com/qtosh1/ton-bot/services/go-bot/internal/config"
	"github.com/qtosh1/ton-bot/services/go-bot/internal/telegram"
	"github.com/qtosh1/ton-bot/services/go-bot/internal/walletapi"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	botAPI, err := tgbotapi.NewBotAPI(cfg.TelegramToken)
	if err != nil {
		log.Fatalf("telegram bot error: %v", err)
	}
	botAPI.Debug = false

	walletClient := walletapi.New(cfg.WalletAPIBase, cfg.HTTPTimeout)
	bot := telegram.New(botAPI, walletClient)
	log.Println("Go Telegram bot started")
	bot.Start()
}
