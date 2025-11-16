package telegram

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"

	"github.com/qtosh1/ton-bot/services/go-bot/internal/walletapi"
)

type Bot struct {
	api       *tgbotapi.BotAPI
	wallet    *walletapi.Client
	transfers sync.Map // map[userID]*transferSession
}

type transferSession struct {
	WalletID int64
	To       string
	Amount   float64
	Step     string
}

func New(api *tgbotapi.BotAPI, wallet *walletapi.Client) *Bot {
	return &Bot{api: api, wallet: wallet}
}

func (b *Bot) Start() {
	u := tgbotapi.NewUpdate(0)
	u.Timeout = 30
	updates := b.api.GetUpdatesChan(u)
	for update := range updates {
		if update.Message != nil {
			b.handleMessage(update.Message)
		} else if update.CallbackQuery != nil {
			b.handleCallback(update.CallbackQuery)
		}
	}
}

func (b *Bot) handleMessage(msg *tgbotapi.Message) {
	if msg.IsCommand() {
		switch msg.Command() {
		case "start", "menu":
			b.sendMenu(msg.Chat.ID)
		case "wallets":
			b.sendWallets(msg.Chat.ID, msg.From.ID)
		default:
			b.reply(msg.Chat.ID, "??????? ?? ??????????????")
		}
		return
	}

	if sessionAny, ok := b.transfers.Load(msg.From.ID); ok {
		session := sessionAny.(*transferSession)
		switch session.Step {
		case "await_wallet":
			id, err := strconv.ParseInt(msg.Text, 10, 64)
			if err != nil {
				b.reply(msg.Chat.ID, "??????? ID ????????")
				return
			}
			session.WalletID = id
			session.Step = "await_to"
			b.reply(msg.Chat.ID, "??????? ????? ??????????")
		case "await_to":
			session.To = msg.Text
			session.Step = "await_amount"
			b.reply(msg.Chat.ID, "??????? ????? ? TON")
		case "await_amount":
			amount, err := strconv.ParseFloat(msg.Text, 64)
			if err != nil || amount <= 0 {
				b.reply(msg.Chat.ID, "???????? ?????")
				return
			}
			session.Amount = amount
			b.executeTransfer(msg.Chat.ID, msg.From.ID, session)
			b.transfers.Delete(msg.From.ID)
		}
		return
	}

	b.reply(msg.Chat.ID, "??????????? ???? ??? ??????? /menu, /wallets")
}

func (b *Bot) handleCallback(cb *tgbotapi.CallbackQuery) {
	switch cb.Data {
	case "menu":
		b.sendMenu(cb.Message.Chat.ID)
	case "wallets":
		b.sendWallets(cb.Message.Chat.ID, cb.From.ID)
	case "wallet:create":
		b.createWallet(cb.Message.Chat.ID, cb.From.ID)
	case "transfer:start":
		b.startTransfer(cb.Message.Chat.ID, cb.From.ID)
	default:
		b.answerCallback(cb.ID, "??????????? ????????")
	}
	b.answerCallback(cb.ID, "")
}

func (b *Bot) sendMenu(chatID int64) {
	text := "???????? ????????"
	kb := tgbotapi.NewInlineKeyboardMarkup(
		tgbotapi.NewInlineKeyboardRow(
			tgbotapi.NewInlineKeyboardButtonData("??? ????????", "wallets"),
			tgbotapi.NewInlineKeyboardButtonData("??????? ???????", "wallet:create"),
		),
		tgbotapi.NewInlineKeyboardRow(
			tgbotapi.NewInlineKeyboardButtonData("??????? TON", "transfer:start"),
		),
	)
	msg := tgbotapi.NewMessage(chatID, text)
	msg.ReplyMarkup = kb
	b.api.Send(msg)
}

func (b *Bot) sendWallets(chatID int64, userID int64) {
	wallets, err := b.wallet.FetchWallets(userID, true)
	if err != nil {
		log.Println("wallet fetch error:", err)
		b.reply(chatID, "?? ??????? ???????? ?????? ?????????")
		return
	}
	if len(wallets) == 0 {
		b.reply(chatID, "????????? ???. ???????? ?????.")
		return
	}
	var rows []string
	for _, w := range wallets {
		rows = append(rows, fmt.Sprintf("#%d\n%s\n??????: %s TON", w.ID, w.Address, w.Balance))
	}
	b.reply(chatID, strings.Join(rows, "\n\n"))
}

func (b *Bot) createWallet(chatID int64, userID int64) {
	wallet, err := b.wallet.CreateWallet(userID)
	if err != nil {
		log.Println("wallet create error:", err)
		b.reply(chatID, "?????? ???????? ????????")
		return
	}
	b.reply(chatID, fmt.Sprintf("?????? ??????? #%d\n%s", wallet.ID, wallet.Address))
}

func (b *Bot) startTransfer(chatID int64, userID int64) {
	b.transfers.Store(userID, &transferSession{Step: "await_wallet"})
	b.reply(chatID, "??????? ID ????????, ?? ???????? ????????? TON")
}

func (b *Bot) executeTransfer(chatID int64, userID int64, session *transferSession) {
	err := b.wallet.Transfer(walletapi.TransferRequest{
		UserID:    userID,
		WalletID:  session.WalletID,
		To:        session.To,
		AmountTon: session.Amount,
	})
	if err != nil {
		log.Println("transfer error:", err)
		b.reply(chatID, fmt.Sprintf("?????? ????????: %v", err))
		return
	}
	b.reply(chatID, "??????? ?????????")
}

func (b *Bot) answerCallback(id, text string) {
	cfg := tgbotapi.NewCallback(id, text)
	b.api.Request(cfg)
}

func (b *Bot) reply(chatID int64, text string) {
	msg := tgbotapi.NewMessage(chatID, text)
	b.api.Send(msg)
}
