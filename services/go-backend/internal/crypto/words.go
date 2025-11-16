package crypto

import (
	"fmt"

	"github.com/xssnick/tonutils-go/ton/wallet"
)

// GenerateMnemonic returns TON-compatible seed words (currently only 24 words are supported).
func GenerateMnemonic(words int) ([]string, error) {
	if words != 24 {
		return nil, fmt.Errorf("only 24-word TON mnemonics are supported")
	}
	seed := wallet.NewSeed()
	return seed, nil
}
