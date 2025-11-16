import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PositionRow, SwapOrder, WalletRow } from '../api/client';
import { fetchWallets, createWallet, fetchSwapOrders, fetchPositions } from '../api/client';

export const useUserStore = defineStore('user', () => {
  const userId = ref<number>(101);
  const wallets = ref<WalletRow[]>([]);
  const loading = ref(false);
  const swapOrders = ref<SwapOrder[]>([]);
  const swapLoading = ref(false);
  const positions = ref<PositionRow[]>([]);
  const positionsLoading = ref(false);
  const error = ref<string | null>(null);

  async function loadWallets() {
    loading.value = true;
    error.value = null;
    try {
      wallets.value = await fetchWallets(userId.value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      wallets.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function loadSwapOrders() {
    swapLoading.value = true;
    try {
      swapOrders.value = await fetchSwapOrders(userId.value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      swapOrders.value = [];
    } finally {
      swapLoading.value = false;
    }
  }

  async function loadPositions() {
    positionsLoading.value = true;
    try {
      positions.value = await fetchPositions(userId.value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      positions.value = [];
    } finally {
      positionsLoading.value = false;
    }
  }

  async function createNewWallet() {
    loading.value = true;
    error.value = null;
    try {
      const created = await createWallet(userId.value);
      wallets.value = [...wallets.value, created];
      return created;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    userId,
    wallets,
    swapOrders,
    positions,
    loading,
    swapLoading,
    positionsLoading,
    error,
    loadWallets,
    createNewWallet,
    loadSwapOrders,
    loadPositions,
  };
});
