# TON Sniper — стартовый каркас (Node.js + TypeScript)

## Быстрый старт
1) Установи зависимости:
   ```bash
   npm install
   npm run bootstrap
   ```
2) Скопируй `.env.example` в `.env` в `/services/bot`, `/services/api`, `/services/relayer` и заполни значения.
3) Подними Postgres и Redis:
   ```bash
   docker compose up -d
   ```
4) Запусти бота и API:
   ```bash
   npm run dev
   ```

### Переменные окружения (пример)
Используй публичный тестнет RPC сейчас, свою ноду подключим позже:
```
TON_RPC_ENDPOINT=https://testnet.toncenter.com/api/v2/jsonRPC
RELAYER_API_KEY=dev-relayer-key
POSTGRES_URL=postgresql://dtrade:secret@localhost:5432/dtrade
REDIS_URL=redis://localhost:6379/0
```
