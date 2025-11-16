package ton

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/xssnick/tonutils-go/address"
	"github.com/xssnick/tonutils-go/tlb"
	"github.com/xssnick/tonutils-go/ton/wallet"
)

// Config describes Ton endpoint settings.
type Config struct {
	Endpoint   string
	APIKey     string
	HTTPClient *http.Client
}

// Client is a thin wrapper over TON Center HTTP APIs.
type Client struct {
	endpoint string
	restBase string
	apiKey   string
	http     *http.Client
}

// NewClient constructs a Ton client helper.
func NewClient(cfg Config) *Client {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	base := strings.TrimRight(cfg.Endpoint, "/")
	rest := base
	if strings.HasSuffix(strings.ToLower(rest), "/jsonrpc") {
		rest = strings.TrimSuffix(rest, "/jsonrpc")
	}
	return &Client{
		endpoint: base,
		restBase: strings.TrimRight(rest, "/"),
		apiKey:   strings.TrimSpace(cfg.APIKey),
		http:     httpClient,
	}
}

// Ping verifies that the configured endpoint looks sane.
func (c *Client) Ping(ctx context.Context) error {
	if c.restBase == "" {
		return errors.New("ton endpoint is not configured")
	}
	var resp tonTimeResponse
	if err := c.call(ctx, "getServerTime", nil, &resp); err != nil {
		return err
	}
	if !resp.Ok {
		return fmt.Errorf("ton ping failed: %s", resp.Error)
	}
	return nil
}

// Balance represents an account balance in both nano and TON units.
type Balance struct {
	Nano string `json:"balance_nton"`
	Ton  string `json:"balance_ton"`
}

// MaxSendable describes estimated transferable values accounting for fees.
type MaxSendable struct {
	Nano string `json:"max_nton"`
	Ton  string `json:"max_ton"`
}

// TransferRequest encapsulates TON transfer parameters.
type TransferRequest struct {
	Mnemonic  string
	To        string
	AmountTon float64
	Comment   string
	Bounce    bool
}

var ErrNotImplemented = errors.New("ton client: not implemented")
var ErrInvalidDestination = errors.New("ton client: invalid destination")
var ErrInsufficientBalance = errors.New("ton client: insufficient balance")

// GetAccountBalance fetches current balance for a wallet address.
func (c *Client) GetAccountBalance(ctx context.Context, addr string) (*Balance, error) {
	var resp tonBalanceResponse
	if err := c.call(ctx, "getAddressBalance", url.Values{"address": {addr}}, &resp); err != nil {
		return nil, err
	}
	if !resp.Ok {
		return nil, fmt.Errorf("ton balance error: %s", resp.Error)
	}
	nano := strings.TrimSpace(resp.Result)
	return &Balance{
		Nano: nano,
		Ton:  formatTonString(nano),
	}, nil
}

// EstimateMaxSendable approximates how much can be transferred right now.
func (c *Client) EstimateMaxSendable(ctx context.Context, addr string) (*MaxSendable, error) {
	bal, err := c.GetAccountBalance(ctx, addr)
	if err != nil {
		return nil, err
	}
	total := parseBigInt(bal.Nano)
	if total == nil {
		return nil, fmt.Errorf("invalid balance value")
	}
	info, err := c.loadAddressInfo(ctx, addr)
	if err != nil {
		return nil, err
	}
	reserve := big.NewInt(20_000_000) // ~0.02 TON for undeployed wallets
	if info != nil && strings.EqualFold(info.State, "active") {
		reserve = big.NewInt(10_000_000) // ~0.01 TON for deployed wallets
	}
	max := new(big.Int).Sub(total, reserve)
	if max.Sign() < 0 {
		max.SetInt64(0)
	}
	return &MaxSendable{
		Nano: max.String(),
		Ton:  formatBigTon(max),
	}, nil
}

// DeriveWalletAddress converts mnemonic words to an address.
func (c *Client) DeriveWalletAddress(words []string) (string, error) {
	priv, err := wallet.SeedToPrivateKey(words, "", false)
	if err != nil {
		return "", err
	}
	pub := priv.Public().(ed25519.PublicKey)
	addr, err := wallet.AddressFromPubKey(pub, wallet.V4R2, wallet.DefaultSubwallet)
	if err != nil {
		return "", err
	}
	return addr.Bounce(false).String(), nil
}

// Transfer pushes an outgoing transfer on behalf of mnemonic.
func (c *Client) Transfer(ctx context.Context, req TransferRequest) error {
	if strings.TrimSpace(req.Mnemonic) == "" {
		return fmt.Errorf("mnemonic is required")
	}
	destAddr, err := address.ParseAddr(strings.TrimSpace(req.To))
	if err != nil {
		return ErrInvalidDestination
	}
	words := strings.Fields(req.Mnemonic)
	if len(words) == 0 {
		return fmt.Errorf("mnemonic is required")
	}
	priv, err := wallet.SeedToPrivateKey(words, "", false)
	if err != nil {
		return fmt.Errorf("mnemonic decode failed: %w", err)
	}
	contract, err := wallet.FromPrivateKey(nil, priv, wallet.V4R2)
	if err != nil {
		return fmt.Errorf("init wallet: %w", err)
	}
	fromAddr := contract.WalletAddress().String()
	walletInfo, err := c.loadWalletInfo(ctx, fromAddr)
	if err != nil {
		return fmt.Errorf("wallet info: %w", err)
	}
	addrInfo, err := c.loadAddressInfo(ctx, fromAddr)
	if err != nil {
		return fmt.Errorf("address info: %w", err)
	}
	balance, err := c.GetAccountBalance(ctx, fromAddr)
	if err != nil {
		return fmt.Errorf("wallet balance: %w", err)
	}
	amountCoins, err := coinsFromFloat(req.AmountTon)
	if err != nil {
		return err
	}
	balanceNano := parseBigInt(balance.Nano)
	if balanceNano == nil {
		return fmt.Errorf("invalid balance")
	}
	stateActive := addrInfo != nil && strings.EqualFold(addrInfo.State, "active")
	reserve := big.NewInt(20_000_000)
	if stateActive {
		reserve = big.NewInt(10_000_000)
	}
	required := new(big.Int).Add(amountCoins.Nano(), reserve)
	if balanceNano.Cmp(required) < 0 {
		return ErrInsufficientBalance
	}
	if spec, ok := contract.GetSpec().(*wallet.SpecV4R2); ok {
		seqno := uint32(0)
		if walletInfo != nil && walletInfo.Seqno >= 0 {
			seqno = uint32(walletInfo.Seqno)
		}
		spec.SetSeqnoFetcher(func(ctx context.Context, subWallet uint32) (uint32, error) {
			return seqno, nil
		})
	}
	msg, err := contract.BuildTransfer(destAddr, amountCoins, req.Bounce, req.Comment)
	if err != nil {
		return fmt.Errorf("build transfer: %w", err)
	}
	withStateInit := !stateActive
	ext, err := contract.PrepareExternalMessageForMany(ctx, withStateInit, []*wallet.Message{msg})
	if err != nil {
		return fmt.Errorf("prepare message: %w", err)
	}
	root, err := tlb.ToCell(ext)
	if err != nil {
		return fmt.Errorf("encode message: %w", err)
	}
	boc := base64.StdEncoding.EncodeToString(root.ToBOC())
	return c.BroadcastBoc(ctx, boc)
}

// BroadcastBoc sends a signed BOC via Toncenter JSON-RPC.
func (c *Client) BroadcastBoc(ctx context.Context, boc string) error {
	if strings.TrimSpace(boc) == "" {
		return fmt.Errorf("boc payload is empty")
	}
	if c.endpoint == "" {
		return errors.New("ton rpc endpoint not configured")
	}
	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "sendTransaction",
		"params": map[string]any{
			"boc": boc,
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("X-API-Key", c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("sendTransaction failed: status %d body %s", resp.StatusCode, string(data))
	}
	var rpcResp rpcResponse
	if err := json.Unmarshal(data, &rpcResp); err != nil {
		return fmt.Errorf("decode rpc response: %w", err)
	}
	if rpcResp.Error != nil {
		return fmt.Errorf("sendTransaction rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	return nil
}

func (c *Client) loadAddressInfo(ctx context.Context, addr string) (*tonAddressInfo, error) {
	var resp tonAddressInfoResponse
	if err := c.call(ctx, "getAddressInformation", url.Values{"address": {addr}}, &resp); err != nil {
		return nil, err
	}
	if !resp.Ok {
		return nil, fmt.Errorf("ton address info error: %s", resp.Error)
	}
	return &resp.Result, nil
}

func (c *Client) loadWalletInfo(ctx context.Context, addr string) (*tonWalletInfo, error) {
	var resp tonWalletInfoResponse
	if err := c.call(ctx, "getWalletInformation", url.Values{"address": {addr}}, &resp); err != nil {
		return nil, err
	}
	if !resp.Ok {
		return nil, fmt.Errorf("ton wallet info error: %s", resp.Error)
	}
	return &resp.Result, nil
}

func (c *Client) call(ctx context.Context, method string, params url.Values, dest any) error {
	if c.restBase == "" {
		return errors.New("ton endpoint not configured")
	}
	u, err := url.Parse(c.restBase + "/" + method)
	if err != nil {
		return err
	}
	if params == nil {
		params = url.Values{}
	}
	if c.apiKey != "" {
		params.Set("api_key", c.apiKey)
	}
	u.RawQuery = params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("ton request %s failed: status %d body %s", method, resp.StatusCode, string(body))
	}
	return json.NewDecoder(resp.Body).Decode(dest)
}

func parseBigInt(value string) *big.Int {
	n := new(big.Int)
	if _, ok := n.SetString(strings.TrimSpace(value), 10); !ok {
		return nil
	}
	return n
}

func formatTonString(nano string) string {
	n := parseBigInt(nano)
	if n == nil {
		return "0"
	}
	return formatBigTon(n)
}

func formatBigTon(n *big.Int) string {
	negative := n.Sign() < 0
	val := new(big.Int).Set(n)
	if negative {
		val.Neg(val)
	}
	denom := big.NewInt(1_000_000_000)
	intPart := new(big.Int).Quo(val, denom)
	frac := new(big.Int).Mod(val, denom)
	fracStr := fmt.Sprintf("%09s", frac.Text(10))
	fracStr = strings.TrimRight(fracStr, "0")
	result := intPart.Text(10)
	if fracStr != "" {
		result = result + "." + fracStr
	}
	if negative && result != "0" {
		result = "-" + result
	}
	return result
}

func coinsFromFloat(amount float64) (tlb.Coins, error) {
	if amount <= 0 || math.IsInf(amount, 0) || math.IsNaN(amount) {
		return tlb.Coins{}, fmt.Errorf("invalid amount")
	}
	str := strconv.FormatFloat(amount, 'f', 9, 64)
	coins, err := tlb.FromTON(str)
	if err != nil {
		return tlb.Coins{}, err
	}
	return coins, nil
}

type tonBalanceResponse struct {
	Ok     bool   `json:"ok"`
	Result string `json:"result"`
	Error  string `json:"error"`
}

type tonAddressInfoResponse struct {
	Ok     bool           `json:"ok"`
	Result tonAddressInfo `json:"result"`
	Error  string         `json:"error"`
}

type tonAddressInfo struct {
	State string `json:"state"`
}

type tonWalletInfoResponse struct {
	Ok     bool          `json:"ok"`
	Result tonWalletInfo `json:"result"`
	Error  string        `json:"error"`
}

type tonWalletInfo struct {
	Seqno int `json:"seqno"`
}

type tonTimeResponse struct {
	Ok     bool   `json:"ok"`
	Result int64  `json:"result"`
	Error  string `json:"error"`
}

type rpcResponse struct {
	Result any       `json:"result"`
	Error  *rpcError `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}
