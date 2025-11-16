# Go Wallet API (prototype)

This module is the first step towards porting the existing Node.js wallet stack to Go. It currently includes:

- Wallet API: configuration loader с parity к TypeScript-сервису (`PORT`, `DATABASE_URL`/`PG*`, `MASTER_KEY_DEV`, TON/Dedust endpoints), PostgreSQL data layer, HKDF+AES-GCM для сидов (TON-compatible генератор), Echo HTTP сервер с маршрутами `/wallets`, `/trading/profile`, `/swap`, `/positions`, `/transfer`. Toncenter-клиент умеет получать балансы/лимиты, derivation адресов и выполнять реальный transfer (`/transfer` → `sendTransaction`). Внутри сервиса есть прототип `SwapRelayer` (включается через `ENABLE_GO_RELAYER=true`), но по умолчанию рекомендуется использовать существующий TypeScript-релейер.
- API service (replacement for `services/api`): lightweight Echo server with `/health`, `/prepare_tx`, `/broadcast`. The `/broadcast` endpoint proxies `sendTransaction` to Toncenter (respecting `RELAYER_API_KEY` + `TON_RPC_ENDPOINT`).

## Running locally

```powershell
cd services/go-backend
# Wallet API
& "C:\Program Files\Go\bin\go.exe" run ./cmd/walletapi

# API service (prepare_tx/broadcast)
& "C:\Program Files\Go\bin\go.exe" run ./cmd/api
```

Both binaries can be built with `go build ./cmd/<service>`.

### Swap relayer (TypeScript)

Пока полноценной Dedust-интеграции на Go нет, для обработки `swap_orders` используйте существующий TypeScript-релейер:

```powershell
cd services/relayer
npm install
npm run dev   # запускает src/main.ts с Dedust-интеграцией, health на http://localhost:4100/health
```

Релейер слушает очередь Redis (`tx:broadcast` по умолчанию), отправляет BOC в Toncenter и экспонирует `/health` (pending, lastBroadcastAt, lastError). Go-служба взаимодействует через общую базу (`swap_orders`). По умолчанию `ENABLE_GO_RELAYER=false`, чтобы использовать этот TS-вариант.

## Environment variables

- `PORT` / `HOST`: listening address (defaults to `0.0.0.0:8090`).
- `DATABASE_URL` or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`: PostgreSQL connection.
- `MASTER_KEY_DEV`: 32-byte key (base64 or `base64:`/`hex:` prefixes) for mnemonic envelope encryption.
- `TON_RPC_ENDPOINT`, `TONCENTER_API_KEY`, `DEDUST_API_BASE_URL`: TON/Dedust connectivity settings (passed through to the Go server).
- `WALLET_LIMIT_PER_USER`, `SHUTDOWN_TIMEOUT`: optional limits/tuning knobs.
- `ENABLE_GO_RELAYER`: when `true`, запускает Go-прототип SwapRelayer (по умолчанию `false`, так как рекомендуем использовать TS-вариант c Dedust SDK).

API service (`cmd/api`) uses:

- `PORT` / `HOST`: HTTP bind (default `0.0.0.0:8080`).
- `RELAYER_API_KEY`: shared secret for `/broadcast` (default `dev-relayer-key`).
- `TON_RPC_ENDPOINT`, `TONCENTER_API_KEY`: Toncenter JSON-RPC endpoint + key.
- `HTTP_TIMEOUT`: optional timeout for Toncenter calls (default `10s`).

## Outstanding work / TODO

Текущие TODO:

1. Реализовать ядро swap-relayer (Dedust, jetton-логика, подписание BOC) вместо заглушки `not_implemented`.
2. Подключить Telegram-бот и trading-автоматику к Go API, после чего постепенно выключить Node-сервисы.
3. Расширить Vue‑dashboard (операции, ордера, мониторинг) и добавить авторизацию.
4. Добавить тесты (unit+integration) для crypto, базы, Ton-клиента и HTTP-роутов.
