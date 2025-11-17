package watcher

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "strings"
    "time"
)

type walletAPIClient struct {
    baseURL string
    http    *http.Client
}

type copytradeSource struct {
    Address string `json:"source_address"`
}

type copytradeSignal struct {
    SourceAddress string  `json:"source_address"`
    Direction     string  `json:"direction"`
    TokenAddress  string  `json:"token_address"`
    TonAmount     float64 `json:"ton_amount"`
    LimitPrice    float64 `json:"limit_price,omitempty"`
    SellPercent   float64 `json:"sell_percent,omitempty"`
    Platform      string  `json:"platform,omitempty"`
}

func newWalletAPIClient(baseURL string, timeout time.Duration) *walletAPIClient {
    return &walletAPIClient{
        baseURL: strings.TrimRight(baseURL, "/"),
        http: &http.Client{Timeout: timeout},
    }
}

func (c *walletAPIClient) listSources(ctx context.Context) ([]copytradeSource, error) {
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/copytrade/sources", nil)
    if err != nil {
        return nil, err
    }
    resp, err := c.http.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 {
        return nil, fmt.Errorf("wallet-api status %d", resp.StatusCode)
    }
    var payload []copytradeSource
    if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
        return nil, err
    }
    return payload, nil
}

func (c *walletAPIClient) sendSignal(ctx context.Context, signal copytradeSignal) error {
    body, err := json.Marshal(signal)
    if err != nil {
        return err
    }
    req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/copytrade/signals", bytes.NewReader(body))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/json")
    resp, err := c.http.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 {
        return fmt.Errorf("wallet-api status %d", resp.StatusCode)
    }
    return nil
}
