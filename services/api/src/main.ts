import 'dotenv/config';
import Fastify from 'fastify';
import { z } from 'zod';
import axios from 'axios';

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT || 8080);
const TON_RPC = process.env.TON_RPC_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
const RELAYER_KEY = process.env.RELAYER_API_KEY || 'dev-relayer-key';

app.get('/health', async () => ({ ok: true }));

app.post('/prepare_tx', async (req, reply) => {
  const schema = z.object({ to: z.string(), amount: z.number().int().positive() });
  const body = schema.parse(req.body ?? {});
  const unsigned = { to: body.to, value: body.amount, fee: 1000000, expire: 60 };
  return { unsigned_payload: unsigned };
});

app.post('/broadcast', async (req, reply) => {
  const key = req.headers['x-api-key'];
  if (key !== RELAYER_KEY) return reply.code(401).send({ error: 'Unauthorized' });

  const schema = z.object({ signed_tx_blob: z.string() });
  const { signed_tx_blob } = schema.parse(req.body ?? {});

  try {
    const payload = { jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: { boc: signed_tx_blob } };
    const { data } = await axios.post(TON_RPC, payload, { timeout: 10_000 });
    return data;
  } catch (e: any) {
    req.log.error(e);
    return reply.code(502).send({ error: 'Node RPC error', detail: e.message });
  }
});

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`\n🚀 API listening on http://localhost:${PORT}`);
});
