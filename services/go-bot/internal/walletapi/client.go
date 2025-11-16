package walletapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client wraps HTTP calls to wallet-api.
type Client struct {
	baseURL string
	http    *http.Client
}

func New(base string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(base, "/"),
		http:    &http.Client{Timeout: timeout},
	}
}

type Wallet struct {
	ID      int64  `json:"id"`
	Address string `json:"address"`
	Balance string `json:"balance_ton"`
}

type TransferRequest struct {
	UserID    int64   `json:"user_id"`
	WalletID  int64   `json:"wallet_id"`
	To        string  `json:"to"`
	AmountTon float64 `json:"amount_ton"`
	Comment   string  `json:"comment,omitempty"`
}

func (c *Client) FetchWallets(userID int64, withBalance bool) ([]Wallet, error) {
	endpoint := fmt.Sprintf("%s/wallets", c.baseURL)
	q := url.Values{}
	q.Set("user_id", fmt.Sprint(userID))
	if withBalance {
		q.Set("with_balance", "1")
	}
	req, err := http.NewRequest(http.MethodGet, endpoint+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("wallets request failed: %s", resp.Status)
	}
	var wallets []Wallet
	if err := json.NewDecoder(resp.Body).Decode(&wallets); err != nil {
		return nil, err
	}
	return wallets, nil
}

func (c *Client) CreateWallet(userID int64) (*Wallet, error) {
	payload := map[string]int64{"user_id": userID}
	body, _ := json.Marshal(payload)
	resp, err := c.http.Post(fmt.Sprintf("%s/wallets", c.baseURL), "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("create wallet failed: %s", resp.Status)
	}
	var wallet Wallet
	if err := json.NewDecoder(resp.Body).Decode(&wallet); err != nil {
		return nil, err
	}
	return &wallet, nil
}

func (c *Client) Transfer(req TransferRequest) error {
	body, _ := json.Marshal(req)
	resp, err := c.http.Post(fmt.Sprintf("%s/transfer", c.baseURL), "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var msg map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&msg)
		return fmt.Errorf("transfer failed: %v", msg)
	}
	return nil
}
