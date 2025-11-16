# TON Bot Dashboard (Vue + Vite)

Панель администрирования для Go-бэкенда. Стек: Vue 3, Vite, TypeScript, Pinia, Vue Router.

## Запуск

```bash
cd services/web-ui
npm install
cp .env.example .env    # при необходимости поправьте API базовые URL
npm run dev             # http://localhost:5173
```

Сборка: `npm run build` (артефакты в `dist/`). Для предпросмотра продакшен-сборки – `npm run preview`.

### Переменные окружения

| Имя | Назначение | По умолчанию |
| --- | ---------- | ------------ |
| `VITE_WALLET_API_BASE` | Базовый URL Go wallet-api (`/wallets`, `/health`, ...) | `http://localhost:8090` |
| `VITE_CORE_API_BASE` | Базовый URL API сервиса (`/prepare_tx`, `/broadcast`) | `http://localhost:8080` |
| `VITE_RELAYER_HEALTH_URL` | Health endpoint TypeScript-релеера (`/health`) | `http://localhost:4100/health` |

## Структура

- `src/api` — тонкие HTTP-helpers для общения с бэкендом.
- `src/components/AppShell.vue` — общий каркас (хедер, фон).
- `src/views/DashboardView.vue` — главная страница: мониторинг сервисов, список кошельков (поддержка создания) и форма отправки TON.
- `src/router` / `src/stores` — подготовлено для дальнейшего расширения (роутинг/Pinia).

## В текущей версии

- Проверка `wallet-api` и `core-api`, кнопка «Обновить».
- Ввод `User ID`, загрузка кошельков пользователя, создание кошелька.
- Простая форма отправки TON (адрес/сумма/комментарий) с отображением ошибок/успеха.
- Монитор swap-ордеров и активных позиций пользователя.

Дальше: монитор swap-ордеров, операции relayer, авторизация и более детальная аналитика.
