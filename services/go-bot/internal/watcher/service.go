package watcher

import (
    "context"
    "log"
    "math"
    "strconv"
    "strings"
    "sync"
    "time"

    "github.com/xssnick/tonutils-go/address"
)

type Watcher struct {
    cfg     Config
    wallet  *walletAPIClient
    tonapi  *tonAPIClient
    states  map[string]*sourceState
    mu      sync.Mutex
}

type sourceState struct {
    Friendly string
    Raw      string
    LastLT   uint64
}

type Signal struct {
    sourceAddress string
    direction     string
    tokenAddress  string
    tonAmount     float64
    platform      string
}

func NewWatcher(cfg Config) *Watcher {
    return &Watcher{
        cfg:    cfg,
        wallet: newWalletAPIClient(cfg.WalletAPIBase, cfg.HTTPTimeout),
        tonapi: newTonAPIClient(cfg.TonAPIBase, cfg.TonAPIKey, cfg.HTTPTimeout),
        states: make(map[string]*sourceState),
    }
}

func (w *Watcher) Run(ctx context.Context) error {
    if err := w.refreshSources(ctx); err != nil {
        log.Printf("[watcher] initial refresh failed: %v", err)
    }
    pollTicker := time.NewTicker(w.cfg.PollInterval)
    refreshTicker := time.NewTicker(w.cfg.SourceRefreshInterval)
    defer pollTicker.Stop()
    defer refreshTicker.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-pollTicker.C:
            w.pollSources(ctx)
        case <-refreshTicker.C:
            if err := w.refreshSources(ctx); err != nil {
                log.Printf("[watcher] refresh failed: %v", err)
            }
        }
    }
}

func (w *Watcher) refreshSources(ctx context.Context) error {
    sources, err := w.wallet.listSources(ctx)
    if err != nil {
        return err
    }
    w.mu.Lock()
    defer w.mu.Unlock()
    existing := make(map[string]struct{})
    for _, src := range sources {
        if src.Address == "" {
            continue
        }
        existing[src.Address] = struct{}{}
        if _, ok := w.states[src.Address]; !ok {
            raw, err := normalizeAddressString(src.Address)
            if err != nil {
                log.Printf("[watcher] skip address %s: %v", src.Address, err)
                continue
            }
            w.states[src.Address] = &sourceState{
                Friendly: src.Address,
                Raw:      raw,
                LastLT:   0,
            }
        }
    }
    for addr := range w.states {
        if _, ok := existing[addr]; !ok {
            delete(w.states, addr)
        }
    }
    log.Printf("[watcher] tracking %d sources", len(w.states))
    return nil
}

func (w *Watcher) pollSources(ctx context.Context) {
    w.mu.Lock()
    states := make([]*sourceState, 0, len(w.states))
    for _, st := range w.states {
        states = append(states, st)
    }
    w.mu.Unlock()
    for _, st := range states {
        events, err := w.tonapi.fetchEvents(ctx, st.Friendly, 20)
        if err != nil {
            log.Printf("[watcher] tonapi fetch %s: %v", st.Friendly, err)
            continue
        }
        w.processEvents(ctx, st, events)
    }
}

func (w *Watcher) processEvents(ctx context.Context, state *sourceState, events []tonEvent) {
    if len(events) == 0 {
        return
    }
    // iterate oldest first
    for i := len(events) - 1; i >= 0; i-- {
        evt := events[i]
        lt, err := strconv.ParseUint(evt.Lt, 10, 64)
        if err != nil {
            continue
        }
        if lt <= state.LastLT {
            continue
        }
        signals := extractSignals(evt, state)
        for _, sig := range signals {
            payload := copytradeSignal{
                SourceAddress: state.Friendly,
                Direction:     sig.direction,
                TokenAddress:  sig.tokenAddress,
                TonAmount:     sig.tonAmount,
                Platform:      sig.platform,
            }
            if err := w.wallet.sendSignal(ctx, payload); err != nil {
                log.Printf("[watcher] send signal failed: %v", err)
            }
        }
        if lt > state.LastLT {
            state.LastLT = lt
        }
    }
}

func normalizeAddressString(addr string) (string, error) {
    a, err := address.ParseAddr(addr)
    if err == nil {
        return a.StringRaw(), nil
    }
    raw, err2 := address.ParseRawAddr(addr)
    if err2 != nil {
        return "", err
    }
    return raw.StringRaw(), nil
}

func extractSignals(evt tonEvent, state *sourceState) []Signal {
    var signals []Signal
    var tonTransfers []tonTonTransfer
    for _, action := range evt.Actions {
        if action.TonTransfer != nil {
            tonTransfers = append(tonTransfers, *action.TonTransfer)
        }
    }
    for _, action := range evt.Actions {
        if action.JettonTransfer == nil {
            continue
        }
        platform := detectPlatform(action.JettonTransfer.Comment)
        if platform == "" {
            continue
        }
        direction := "buy"
        if sameAddress(action.JettonTransfer.Sender.Address, state.Raw) {
            direction = "sell"
        }
        tonAmount := selectTonAmount(tonTransfers, state.Raw, direction)
        if tonAmount <= 0 {
            continue
        }
        signals = append(signals, Signal{
            sourceAddress: state.Friendly,
            direction:     direction,
            tokenAddress:  action.JettonTransfer.Jetton.Address,
            tonAmount:     tonAmount,
            platform:      platform,
        })
    }
    return signals
}

func detectPlatform(comment string) string {
    comment = strings.ToLower(comment)
    switch {
    case strings.Contains(comment, "dedust"):
        return "dedust"
    case strings.Contains(comment, "ston"):
        return "stonfi"
    case strings.Contains(comment, "ton.fun"):
        return "tonfun"
    case strings.Contains(comment, "gaspump"):
        return "gaspump"
    case strings.Contains(comment, "memes"):
        return "memeslab"
    case strings.Contains(comment, "blum"):
        return "blum"
    default:
        return ""
    }
}

func selectTonAmount(transfers []tonTonTransfer, walletRaw string, direction string) float64 {
    for _, tr := range transfers {
        if direction == "sell" {
            if sameAddress(tr.Recipient.Address, walletRaw) {
                return nanoToTon(tr.Amount)
            }
        } else {
            if sameAddress(tr.Sender.Address, walletRaw) {
                return nanoToTon(tr.Amount)
            }
        }
    }
    return 0
}

func sameAddress(a, b string) bool {
    return normalizeZeroAddress(a) == normalizeZeroAddress(b)
}

func normalizeZeroAddress(a string) string {
    return strings.TrimSpace(strings.ToLower(a))
}

func nanoToTon(value string) float64 {
    n, err := strconv.ParseFloat(value, 64)
    if err != nil {
        return 0
    }
    return math.Round((n/1_000_000_000)*1e9) / 1e9
}
