package relayer

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/qtosh1/ton-bot/services/go-backend/internal/database"
)

// Logger is a minimal logging interface used by the relayer.
type Logger interface {
	Printf(format string, v ...any)
}

// Options configure SwapRelayer.
type Options struct {
	Store     *database.Store
	Logger    Logger
	MasterKey []byte
}

// SwapRelayer polls swap_orders and will execute swaps (WIP).
type SwapRelayer struct {
	opts      Options
	closing   chan struct{}
	closed    chan struct{}
	started   bool
	stopDelay time.Duration
}

// New creates a new relayer instance.
func New(opts Options) *SwapRelayer {
	logger := opts.Logger
	if logger == nil {
		logger = log.Default()
	}
	return &SwapRelayer{
		opts:      Options{Store: opts.Store, Logger: logger, MasterKey: opts.MasterKey},
		closing:   make(chan struct{}),
		closed:    make(chan struct{}),
		stopDelay: 2 * time.Second,
	}
}

// Start launches the relayer loop.
func (r *SwapRelayer) Start(ctx context.Context) {
	if r.started {
		return
	}
	r.started = true
	go r.loop(ctx)
}

// Stop requests graceful shutdown.
func (r *SwapRelayer) Stop() {
	select {
	case <-r.closing:
	default:
		close(r.closing)
	}
	<-r.closed
}

func (r *SwapRelayer) loop(ctx context.Context) {
	r.log("swap relayer started (Go prototype)")
	defer func() {
		close(r.closed)
		r.log("swap relayer stopped")
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.closing:
			return
		default:
		}
		if err := r.processNext(ctx); err != nil {
			if !errors.Is(err, context.Canceled) {
				r.log("relayer error: %v", err)
			}
			time.Sleep(3 * time.Second)
			continue
		}
		time.Sleep(r.stopDelay)
	}
}

func (r *SwapRelayer) processNext(ctx context.Context) error {
	order, err := r.opts.Store.ClaimNextSwapOrder(ctx)
	if err != nil {
		return err
	}
	if order == nil {
		return nil
	}

	_, updErr := r.opts.Store.UpdateSwapOrderStatus(ctx, order.ID, "error", database.UpdateSwapOrderOptions{
		Error: strPtr("not_implemented"),
	})
	if updErr != nil {
		return updErr
	}
	r.log("swap order %d marked as not implemented", order.ID)
	return nil
}

func (r *SwapRelayer) log(format string, v ...any) {
	if r.opts.Logger != nil {
		r.opts.Logger.Printf("[relayer] "+format, v...)
	}
}

func strPtr(s string) *string {
	return &s
}
