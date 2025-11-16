import 'dotenv/config';
import axios from 'axios';
import Redis from 'ioredis';
import Fastify from 'fastify';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379/0');
const TON_RPC = process.env.TON_RPC_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
const QUEUE_KEY = process.env.BROADCAST_QUEUE_KEY || 'tx:broadcast';
const PORT = Number(process.env.RELAYER_PORT || 4100);

let lastBroadcastAt: string | null = null;
let lastError: string | null = null;

async function startHealthServer() {
  const app = Fastify({ logger: false });
  app.get('/health', async () => {
    const pending = await redis.llen(QUEUE_KEY);
    return {
      ok: true,
      pending,
      lastBroadcastAt,
      lastError,
    };
  });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[relayer] health endpoint http://0.0.0.0:${PORT}/health`);
}

async function startQueueLoop() {
  console.log('[relayer] queue loop started');
  while (true) {
    const item = await redis.blpop(QUEUE_KEY, 0);
    const boc = item?.[1];
    if (!boc) continue;
    try {
      const payload = { jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: { boc } };
      const { data } = await axios.post(TON_RPC, payload, { timeout: 10_000 });
      lastBroadcastAt = new Date().toISOString();
      lastError = null;
      console.log('[relayer] broadcast ok:', data);
    } catch (e: any) {
      lastError = e?.message || 'unknown_error';
      console.error('[relayer] broadcast error:', lastError);
    }
  }
}

async function main() {
  startHealthServer().catch((err) => {
    console.error('[relayer] failed to start health server:', err);
  });
  await startQueueLoop();
}

main().catch((err) => {
  console.error('[relayer] crashed:', err);
  process.exit(1);
});
