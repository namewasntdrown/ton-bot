package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// EncryptMnemonic reproduces the TypeScript hkdf + AES-GCM envelope scheme.
func EncryptMnemonic(masterKey []byte, mnemonic string) (string, error) {
	if len(masterKey) == 0 {
		return "", errors.New("master key is empty")
	}

	salt, err := randomBytes(16)
	if err != nil {
		return "", err
	}
	recordKey, err := randomBytes(32)
	if err != nil {
		return "", err
	}
	kek := hkdfSha256(masterKey, salt, "enc-kek")

	ciphertext, iv, tag, err := encryptAESGCM(recordKey, []byte(mnemonic))
	if err != nil {
		return "", err
	}
	encRecordKey, err := encryptRecordKey(kek, recordKey)
	if err != nil {
		return "", err
	}

	payload := envelope{
		Ciphertext:   base64.StdEncoding.EncodeToString(ciphertext),
		IV:           base64.StdEncoding.EncodeToString(iv),
		Tag:          base64.StdEncoding.EncodeToString(tag),
		Salt:         base64.StdEncoding.EncodeToString(salt),
		EncRecordKey: base64.StdEncoding.EncodeToString(encRecordKey),
		KDF:          "hkdf-sha256:v1",
		Alg:          "aes-256-gcm",
		Version:      1,
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// DecryptMnemonic reverses EncryptMnemonic, returning the clear text mnemonic.
func DecryptMnemonic(masterKey []byte, payload string) (string, error) {
	if len(masterKey) == 0 {
		return "", errors.New("master key is empty")
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", fmt.Errorf("decode payload: %w", err)
	}
	var body envelope
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", fmt.Errorf("parse payload: %w", err)
	}
	if body.KDF != "hkdf-sha256:v1" || body.Alg != "aes-256-gcm" {
		return "", errors.New("unsupported encryption format")
	}

	salt, err := base64.StdEncoding.DecodeString(body.Salt)
	if err != nil {
		return "", fmt.Errorf("decode salt: %w", err)
	}
	kek := hkdfSha256(masterKey, salt, "enc-kek")

	encRecordKey, err := base64.StdEncoding.DecodeString(body.EncRecordKey)
	if err != nil {
		return "", fmt.Errorf("decode record key: %w", err)
	}
	recordKey, err := decryptRecordKey(kek, encRecordKey)
	if err != nil {
		return "", err
	}

	iv, err := base64.StdEncoding.DecodeString(body.IV)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	tag, err := base64.StdEncoding.DecodeString(body.Tag)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(body.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	plaintext, err := decryptAESGCM(recordKey, ciphertext, iv, tag)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func hkdfSha256(master, salt []byte, info string) []byte {
	h := sha256.Sum256(append(master, salt...))
	inp := append(h[:], []byte(info)...)
	inp = append(inp, 0x01)
	out := sha256.Sum256(inp)
	return out[:]
}

func randomBytes(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func encryptAESGCM(key, plaintext []byte) (ciphertext, iv, tag []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, nil, err
	}
	iv, err = randomBytes(gcm.NonceSize())
	if err != nil {
		return nil, nil, nil, err
	}
	sealed := gcm.Seal(nil, iv, plaintext, nil)
	tagSize := gcm.Overhead()
	if len(sealed) >= tagSize {
		tag = sealed[len(sealed)-tagSize:]
		ciphertext = sealed[:len(sealed)-tagSize]
	} else {
		return nil, nil, nil, errors.New("ciphertext shorter than tag")
	}
	return
}

func encryptRecordKey(kek, recordKey []byte) ([]byte, error) {
	block, err := aes.NewCipher(kek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	iv, err := randomBytes(gcm.NonceSize())
	if err != nil {
		return nil, err
	}
	enc := gcm.Seal(nil, iv, recordKey, nil)
	tagSize := gcm.Overhead()
	if len(enc) < tagSize {
		return nil, errors.New("invalid record key ciphertext")
	}
	tag := enc[len(enc)-tagSize:]
	body := enc[:len(enc)-tagSize]
	payload := append(iv, tag...)
	payload = append(payload, body...)
	return payload, nil
}

func decryptRecordKey(kek, payload []byte) ([]byte, error) {
	block, err := aes.NewCipher(kek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	tagSize := gcm.Overhead()
	if len(payload) < nonceSize+tagSize {
		return nil, errors.New("enc record key too short")
	}
	iv := payload[:nonceSize]
	tag := payload[nonceSize : nonceSize+tagSize]
	body := payload[nonceSize+tagSize:]
	ciphertext := append(body, tag...)
	plaintext, err := gcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

func decryptAESGCM(key, ciphertext, iv, tag []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	full := append([]byte{}, ciphertext...)
	full = append(full, tag...)
	return gcm.Open(nil, iv, full, nil)
}

type envelope struct {
	Ciphertext   string `json:"ciphertext"`
	IV           string `json:"iv"`
	Tag          string `json:"tag"`
	Salt         string `json:"salt"`
	EncRecordKey string `json:"enc_record_key"`
	KDF          string `json:"kdf"`
	Alg          string `json:"alg"`
	Version      int    `json:"v"`
}
