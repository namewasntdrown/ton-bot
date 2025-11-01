import 'dotenv/config';
import axios from 'axios';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379/0');
const TON_RPC = process.env.TON_RPC_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';

async function boot() {
  console.log('📦 Relayer mock started');
  while (true) {
    const item = await redis.blpop('tx:broadcast', 0);
    const boc = item?.[1];
    if (!boc) continue;
    try {
      const payload = { jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: { boc } };
      const { data } = await axios.post(TON_RPC, payload, { timeout: 10_000 });
      console.log('✅ Broadcast ok:', data);
    } catch (e: any) {
      console.error('❌ Broadcast error:', e.message);
    }
  }
}

boot();
