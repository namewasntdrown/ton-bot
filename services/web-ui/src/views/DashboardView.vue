<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  fetchWalletApiHealth,
  fetchCoreApiHealth,
  transferTon,
  type WalletRow,
  fetchRelayerHealth,
  hasRelayerHealthEndpoint,
} from '../api/client';
import { useUserStore } from '../stores/user';

type HealthStatus = 'loading' | 'ok' | 'error';
type TransferState = 'idle' | 'loading' | 'success' | 'error';

const walletApiStatus = ref<{ state: HealthStatus; detail?: string }>({ state: 'loading' });
const coreApiStatus = ref<{ state: HealthStatus; detail?: string }>({ state: 'loading' });

const userStore = useUserStore();
const {
  userId,
  wallets,
  loading,
  error,
  swapOrders,
  swapLoading,
  positions,
  positionsLoading,
} =
  storeToRefs(userStore);

const userIdInput = computed({
  get: () => String(userId.value),
  set: (val: string) => {
    const parsed = Number(val);
    userId.value = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  },
});

const transferForm = reactive({
  walletId: '',
  to: '',
  amountTon: '0.1',
  comment: '',
});
const transferState = ref<{ state: TransferState; message?: string }>({ state: 'idle' });
const relayerStatus = ref<{
  state: HealthStatus;
  pending?: number;
  detail?: string;
  lastBroadcastAt?: string | null;
}>({
  state: hasRelayerHealthEndpoint ? 'loading' : 'error',
  detail: hasRelayerHealthEndpoint ? undefined : 'not_configured',
});

async function refreshHealth() {
  await Promise.all([refreshWalletApiHealth(), refreshCoreApiHealth(), refreshRelayerHealth()]);
}

async function refreshWalletApiHealth() {
  walletApiStatus.value = { state: 'loading' };
  try {
    await fetchWalletApiHealth();
    walletApiStatus.value = { state: 'ok' };
  } catch (err) {
    walletApiStatus.value = { state: 'error', detail: getErrorMessage(err) };
  }
}

async function refreshCoreApiHealth() {
  coreApiStatus.value = { state: 'loading' };
  try {
    await fetchCoreApiHealth();
    coreApiStatus.value = { state: 'ok' };
  } catch (err) {
    coreApiStatus.value = { state: 'error', detail: getErrorMessage(err) };
  }
}

async function refreshRelayerHealth() {
  if (!hasRelayerHealthEndpoint) {
    relayerStatus.value = { state: 'error', detail: 'not_configured' };
    return;
  }
  try {
    const data = await fetchRelayerHealth();
    relayerStatus.value = {
      state: 'ok',
      pending: data.pending,
      lastBroadcastAt: data.lastBroadcastAt,
      detail: data.lastError || undefined,
    };
  } catch (err) {
    relayerStatus.value = { state: 'error', detail: getErrorMessage(err) };
  }
}

async function handleLoadWallets() {
  await Promise.all([
    userStore.loadWallets(),
    userStore.loadSwapOrders(),
    userStore.loadPositions(),
  ]);
}

async function handleCreateWallet() {
  try {
    await userStore.createNewWallet();
  } catch (err) {
    walletApiStatus.value = { state: 'error', detail: getErrorMessage(err) };
  }
}

async function handleTransfer() {
  if (!transferForm.walletId || !transferForm.to || !transferForm.amountTon) {
    transferState.value = { state: 'error', message: 'Заполните все поля' };
    return;
  }
  transferState.value = { state: 'loading' };
  try {
    await transferTon({
      userId: userId.value,
      walletId: Number(transferForm.walletId),
      to: transferForm.to.trim(),
      amountTon: Number(transferForm.amountTon),
      comment: transferForm.comment || undefined,
    });
    transferState.value = { state: 'success', message: 'Перевод отправлен' };
    transferForm.to = '';
    transferForm.amountTon = '0.1';
    transferForm.comment = '';
    await Promise.all([
      userStore.loadWallets(),
      userStore.loadSwapOrders(),
      userStore.loadPositions(),
    ]);
  } catch (err) {
    transferState.value = { state: 'error', message: getErrorMessage(err) };
  }
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

const walletsEmpty = computed(() => (wallets.value?.length ?? 0) === 0);

watch(
  wallets,
  (list) => {
    const safeList: WalletRow[] = list ?? [];
    const [first] = safeList;
    if (!first) {
      transferForm.walletId = '';
      return;
    }
    if (!transferForm.walletId) {
      transferForm.walletId = String(first.id);
      return;
    }
    const exists = safeList.some((wallet) => String(wallet.id) === transferForm.walletId);
    if (!exists) {
      transferForm.walletId = String(first.id);
    }
  },
  { immediate: true }
);

onMounted(() => {
  refreshHealth();
  userStore.loadWallets();
  userStore.loadSwapOrders();
  userStore.loadPositions();
});
</script>

<template>
  <section class="grid">
    <article class="card">
      <header class="card__header">
        <div>
          <p class="card__eyebrow">Инфраструктура</p>
          <h2>Статус сервисов</h2>
        </div>
        <button class="ghost-btn" @click="refreshHealth">Обновить</button>
      </header>

      <div class="status-list">
        <div class="status-item">
          <span class="status-item__label">Wallet API</span>
          <span :class="['badge', walletApiStatus.state]">
            {{ walletApiStatus.state === 'ok' ? 'online' : walletApiStatus.state }}
          </span>
        </div>
        <p v-if="walletApiStatus.detail" class="status-note">
          {{ walletApiStatus.detail }}
        </p>

        <div class="status-item">
          <span class="status-item__label">Core API</span>
          <span :class="['badge', coreApiStatus.state]">
            {{ coreApiStatus.state === 'ok' ? 'online' : coreApiStatus.state }}
          </span>
        </div>
        <p v-if="coreApiStatus.detail" class="status-note">
          {{ coreApiStatus.detail }}
        </p>
      </div>
    </article>

    <article class="card">
      <header class="card__header">
        <div>
          <p class="card__eyebrow">Кошельки</p>
          <h2>Панель пользователя</h2>
        </div>
        <div class="input-group">
          <label for="user">User ID:</label>
          <input id="user" v-model="userIdInput" type="number" min="1" />
          <button class="ghost-btn" :disabled="loading" @click="handleLoadWallets">
            {{ loading ? 'Загрузка...' : 'Показать' }}
          </button>
          <button class="ghost-btn" :disabled="loading" @click="handleCreateWallet">
            Создать кошелек
          </button>
        </div>
      </header>

      <p v-if="error" class="status-note">{{ error }}</p>

      <div v-if="loading" class="empty-state">Загружаем кошельки...</div>
      <div v-else-if="walletsEmpty" class="empty-state">Нет кошельков.</div>
      <ul v-else class="wallet-list">
        <li v-for="wallet in wallets" :key="wallet.id" class="wallet-item">
          <div>
            <p class="wallet-item__id">#{{ wallet.id }}</p>
            <p class="wallet-item__address">{{ wallet.address }}</p>
          </div>
          <p class="wallet-item__balance">
            {{ wallet.balance_ton ? wallet.balance_ton + ' TON' : '—' }}
          </p>
        </li>
      </ul>
    </article>

    <article class="card">
      <header class="card__header">
        <div>
          <p class="card__eyebrow">Relayer</p>
          <h2>Dedust исполнение</h2>
        </div>
        <button class="ghost-btn" @click="refreshRelayerHealth" :disabled="!hasRelayerHealthEndpoint">
          Обновить
        </button>
      </header>
      <div class="status-list">
        <div class="status-item">
          <span class="status-item__label">Relayer</span>
          <span :class="['badge', relayerStatus.state]">
            {{ relayerStatus.state === 'ok' ? 'online' : relayerStatus.state }}
          </span>
        </div>
        <p class="status-note">
          Очередь: {{ relayerStatus.pending ?? '—' }} |
          Последний broadcast:
          {{ relayerStatus.lastBroadcastAt ? new Date(relayerStatus.lastBroadcastAt).toLocaleString() : '—' }}
        </p>
        <p v-if="relayerStatus.detail" class="status-note">
          {{ relayerStatus.detail }}
        </p>
        <p v-if="!hasRelayerHealthEndpoint" class="status-note">
          Установите `VITE_RELAYER_HEALTH_URL`, чтобы включить мониторинг.
        </p>
      </div>
    </article>

    <article class="card">
      <header class="card__header">
        <div>
          <p class="card__eyebrow">Переводы</p>
          <h2>Отправить TON</h2>
        </div>
      </header>
      <form class="transfer-form" @submit.prevent="handleTransfer">
        <label>
          Кошелек:
          <select v-model="transferForm.walletId" required>
            <option value="" disabled>Выберите</option>
            <option v-for="wallet in wallets" :key="wallet.id" :value="wallet.id">
              #{{ wallet.id }} · {{ wallet.address.slice(0, 12) }}…
            </option>
          </select>
        </label>
        <label>
          Адрес получателя:
          <input v-model="transferForm.to" type="text" placeholder="UQ..." required />
        </label>
        <label>
          Сумма (TON):
          <input v-model="transferForm.amountTon" type="number" step="0.000000001" min="0.000001" required />
        </label>
        <label>
          Комментарий:
          <input v-model="transferForm.comment" type="text" placeholder="Необязательно" />
        </label>
        <button class="ghost-btn" type="submit" :disabled="transferState.state === 'loading'">
          {{ transferState.state === 'loading' ? 'Отправляем...' : 'Отправить' }}
        </button>
        <p v-if="transferState.message" :class="['status-note', transferState.state]">
          {{ transferState.message }}
        </p>
      </form>
    </article>

    <article class="card">
      <header class="card__header">
        <div>
          <p class="card__eyebrow">Swap ордера</p>
          <h2>История / очередь</h2>
        </div>
      </header>
      <div v-if="swapLoading" class="empty-state">Загружаем ордера...</div>
      <div v-else-if="!swapOrders.length" class="empty-state">Ордера отсутствуют.</div>
      <table v-else class="orders-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Кошелек</th>
            <th>Направление</th>
            <th>TON</th>
            <th>Статус</th>
            <th>Обновлен</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in swapOrders" :key="order.id">
            <td>#{{ order.id }}</td>
            <td>{{ order.wallet_id }}</td>
            <td>{{ order.direction }}</td>
            <td>{{ order.ton_amount }}</td>
            <td>
              <span :class="['badge', 'badge--' + order.status]">
                {{ order.status }}
              </span>
            </td>
            <td>{{ new Date(order.updated_at).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </article>

    <article class="card">
      <header class="card__header">
        <div>
          <p class="card__eyebrow">Позиции</p>
          <h2>Активные токены</h2>
        </div>
      </header>
      <div v-if="positionsLoading" class="empty-state">Загружаем позиции...</div>
      <div v-else-if="!positions.length" class="empty-state">Нет активных позиций.</div>
      <table v-else class="orders-table">
        <thead>
          <tr>
            <th>Токен</th>
            <th>Адрес</th>
            <th>Количество</th>
            <th>Инвестировано TON</th>
            <th>Кошелек</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="pos in positions" :key="pos.id">
            <td>
              <div class="token-cell">
                <img v-if="pos.token_image" :src="pos.token_image" alt="" />
                <div>
                  <div>{{ pos.token_symbol || '—' }}</div>
                  <div class="token-name">{{ pos.token_name || '—' }}</div>
                </div>
              </div>
            </td>
            <td>{{ pos.token_address.slice(0, 10) }}…</td>
            <td>{{ pos.amount }}</td>
            <td>{{ pos.invested_ton }}</td>
            <td>{{ pos.wallet_address?.slice(0, 10) || '—' }}…</td>
            <td>{{ new Date(pos.updated_at).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.5rem;
}

.card {
  background: #141925;
  border: 1px solid #1e2330;
  border-radius: 16px;
  padding: 1.75rem;
  box-shadow: 0 20px 35px rgba(0, 0, 0, 0.25);
}

.card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.card__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
  color: #78a9ff;
  margin: 0 0 0.35rem 0;
}

.card h2 {
  margin: 0;
  font-size: 1.4rem;
}

.status-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.8rem 0;
  border-bottom: 1px solid #21283a;
}

.status-item:last-child {
  border-bottom: none;
}

.status-item__label {
  font-weight: 500;
}

.status-note {
  margin: 0;
  font-size: 0.85rem;
  color: #f58c8c;
}

.badge {
  padding: 0.25rem 0.85rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
}

.badge.ok {
  background: rgba(76, 214, 144, 0.15);
  color: #56f0a6;
}

.badge.loading {
  background: rgba(255, 215, 125, 0.12);
  color: #ffd77d;
}

.badge.error {
  background: rgba(255, 118, 118, 0.15);
  color: #ff8383;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.input-group label {
  font-size: 0.9rem;
  color: #9ba6bd;
}

.input-group input {
  background: #0c0f18;
  border: 1px solid #1f2534;
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  color: #f2f5f7;
  width: 110px;
}

.ghost-btn {
  border: 1px solid rgba(118, 129, 255, 0.6);
  border-radius: 10px;
  background: transparent;
  color: #c8d1ff;
  font-weight: 500;
  padding: 0.45rem 0.95rem;
  transition: background 0.2s ease;
  cursor: pointer;
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ghost-btn:not(:disabled):hover {
  background: rgba(118, 129, 255, 0.12);
}

.empty-state {
  padding: 1rem;
  text-align: center;
  color: #8b94aa;
  border: 1px dashed #2a3042;
  border-radius: 10px;
  background: rgba(14, 17, 26, 0.6);
}

.wallet-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.wallet-item {
  display: flex;
  justify-content: space-between;
  padding: 0.9rem 1rem;
  background: rgba(18, 26, 41, 0.9);
  border-radius: 12px;
  border: 1px solid #1f2534;
}

.wallet-item__id {
  margin: 0;
  color: #7f8ab0;
  font-size: 0.85rem;
}

.wallet-item__address {
  margin: 0.2rem 0 0 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.95rem;
}

.wallet-item__balance {
  margin: 0;
  align-self: center;
  font-weight: 600;
  color: #65f0c5;
}

.orders-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.orders-table th,
.orders-table td {
  text-align: left;
  padding: 0.65rem 0.4rem;
  border-bottom: 1px solid #1f2638;
}

.orders-table th {
  color: #9ba6bd;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.8rem;
}

.orders-table tr:last-child td {
  border-bottom: none;
}

.badge--queued {
  background: rgba(255, 152, 67, 0.15);
  color: #ffba82;
}
.badge--processing {
  background: rgba(81, 158, 255, 0.15);
  color: #8fc1ff;
}
.badge--done,
.badge--completed {
  background: rgba(76, 214, 144, 0.15);
  color: #56f0a6;
}
.badge--error {
  background: rgba(255, 118, 118, 0.15);
  color: #ff8383;
}

.token-cell {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.token-cell img {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}

.token-name {
  font-size: 0.75rem;
  color: #8590af;
}

.transfer-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.transfer-form label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.95rem;
  color: #c3cbdf;
}

.transfer-form input,
.transfer-form select {
  background: #0c0f18;
  border: 1px solid #1f2534;
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  color: #f2f5f7;
  font-size: 0.95rem;
}

.status-note.error {
  color: #ff8a8a;
}

.status-note.success {
  color: #7ef0c6;
}

@media (max-width: 640px) {
  .input-group {
    flex-direction: column;
    align-items: flex-start;
  }

  .input-group input {
    width: 100%;
  }

  .wallet-item {
    flex-direction: column;
    gap: 0.6rem;
  }
}
</style>
