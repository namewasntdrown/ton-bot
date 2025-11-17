package watcher

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "net/url"
    "strings"
    "time"
)

type tonAPIClient struct {
    baseURL string
    apiKey  string
    http    *http.Client
}

type tonEventResponse struct {
    Events []tonEvent `json:"events"`
}

type tonEvent struct {
    Lt      string       `json:"lt"`
    Actions []tonAction  `json:"actions"`
}

type tonAction struct {
    Type            string             `json:"type"`
    JettonTransfer  *tonJettonTransfer `json:"JettonTransfer,omitempty"`
    TonTransfer     *tonTonTransfer    `json:"TonTransfer,omitempty"`
}

type tonAccountRef struct {
    Address string `json:"address"`
}

type tonJettonInfo struct {
    Address string `json:"address"`
    Symbol  string `json:"symbol"`
}

type tonJettonTransfer struct {
    Sender    tonAccountRef  `json:"sender"`
    Recipient tonAccountRef  `json:"recipient"`
    Amount    string         `json:"amount"`
    Comment   string         `json:"comment"`
    Jetton    tonJettonInfo  `json:"jetton"`
}

type tonTonTransfer struct {
    Sender    tonAccountRef `json:"sender"`
    Recipient tonAccountRef `json:"recipient"`
    Amount    string        `json:"amount"`
}

func newTonAPIClient(baseURL, apiKey string, timeout time.Duration) *tonAPIClient {
    return &tonAPIClient{
        baseURL: strings.TrimRight(baseURL, "/"),
        apiKey:  apiKey,
        http: &http.Client{
            Timeout: timeout,
        },
    }
}

func (c *tonAPIClient) fetchEvents(ctx context.Context, address string, limit int) ([]tonEvent, error) {
    if limit <= 0 || limit > 100 {
        limit = 20
    }
    endpoint := fmt.Sprintf("%s/v2/accounts/%s/events", c.baseURL, url.PathEscape(address))
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+fmt.Sprintf("?limit=%d", limit), nil)
    if err != nil {
        return nil, err
    }
    if c.apiKey != "" {
        req.Header.Set("Authorization", "Bearer "+c.apiKey)
    }
    resp, err := c.http.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 {
        return nil, fmt.Errorf("tonapi status %d", resp.StatusCode)
    }
    var payload tonEventResponse
    if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
        return nil, err
    }
    return payload.Events, nil
}
