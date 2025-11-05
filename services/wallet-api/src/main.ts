// services/wallet-api/src/main.ts
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { migrate, listWalletsByUser, countWalletsByUser, insertWallet, getWalletById, getWalletSecretById } from './db';
import { encryptMnemonic, decryptMnemonic } from './crypto';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, Address, internal, toNano, beginCell, TonClient } from '@ton/ton';

// MASTER parsing with prefixes
const raw = process.env.MASTER_KEY_DEV || '';
if (!raw) {
  // fastify logger not ready yet; warn after app init as well
  console.warn('MASTER_KEY_DEV is not set. Wallet encryption will fail.');
}
const MASTER = raw
  ? (raw.startsWith('base64:')
      ? Buffer.from(raw.slice(7), 'base64')
      : raw.startsWith('hex:')
      ? Buffer.from(raw.slice(4), 'hex')
      : Buffer.from(raw, 'base64'))
  : null;

const PORT = Number(process.env.PORT || 8090);
const TON_RPC = process.env.TON_RPC_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';
const TON_API_KEY = process.env.TONCENTER_API_KEY || undefined;

async function deriveTonAddress(wordsArr: string[]) {
  const { publicKey } = await mnemonicToPrivateKey(wordsArr);
  const wc = WalletContractV4.create({ workchain: 0, publicKey });
  return wc.address.toString();
}

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true }));

  app.addHook('onReady', async () => {
    await migrate();
    if (!MASTER || MASTER.length !== 32) app.log.warn('MASTER_KEY_DEV missing or invalid length (need 32 bytes).');
  });

  // GET /wallets?user_id=...
  const QueryUserId = z.object({ user_id: z.coerce.number().int().nonnegative() });
  const CreateWalletDto = z.object({ user_id: z.coerce.number().int().nonnegative() });

  app.get('/wallets', async (req, reply) => {
    try {
      const { user_id } = QueryUserId.parse((req.query ?? {}) as any);
      const userId = user_id;

      const rows = await listWalletsByUser(userId);
      return reply.send(rows);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /wallets error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // POST /wallets { user_id: number }
  app.post('/wallets', async (req, reply) => {
    try {
      const { user_id } = CreateWalletDto.parse((req.body ?? {}) as any);
      const userId = user_id;

      const c = await countWalletsByUser(userId);
      if (c >= 3) return reply.code(400).send({ error: 'limit' });

      // 1) генерим сид
      const wordsArr = await mnemonicNew(24);
      const words = wordsArr.join(' ');

      // 2) адрес
      const address = await deriveTonAddress(wordsArr);

      // 3) шифруем сид
      if (!raw || !MASTER || MASTER.length !== 32) {
        return reply.code(500).send({ error: 'server_misconfiguration' });
      }
      const enc = encryptMnemonic(MASTER, words);

      // 4) сохраняем
      const ins = await insertWallet({ user_id: userId, address, encrypted_mnemonic: enc });
      return reply.code(201).send(ins);
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      app.log.error({ msg: err?.message, stack: err?.stack }, 'POST /wallets error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // GET /wallets/:id
  app.get('/wallets/:id', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const row = await getWalletById(id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return reply.send(row);
    } catch (err: any) {
      app.log.error({ msg: err?.message, stack: err?.stack }, 'GET /wallets/:id error');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // GET /wallets/:id/balance — баланс TON в нанотонах (string)
  app.get('/wallets/:id/balance', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const row = await getWalletById(id);
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const client = new TonClient({ endpoint: TON_RPC, apiKey: TON_API_KEY } as any);
      const balance = await client.getBalance(Address.parse(row.address));
      return reply.send({ balance: balance.toString() });
    } catch (err: any) {
      console.error('GET /wallets/:id/balance error:', err?.message, err?.stack);
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // POST /transfer { user_id:number, wallet_id:number, to:string, amount_ton:number, comment?:string }
  const TransferDto = z.object({
    user_id: z.coerce.number().int().nonnegative(),
    wallet_id: z.coerce.number().int().positive(),
    to: z.string().min(3),
    amount_ton: z.coerce.number().positive(),
    comment: z.string().max(200).optional(),
  });

  app.post('/transfer', async (req, reply) => {
    try {
      const { user_id, wallet_id, to, amount_ton, comment } = TransferDto.parse((req.body ?? {}) as any);

      const w = await getWalletSecretById(wallet_id);
      if (!w || Number((w as any).user_id) !== user_id) return reply.code(404).send({ error: 'not_found' });

      if (!raw || !MASTER || MASTER.length !== 32) return reply.code(500).send({ error: 'server_misconfiguration' });

      const mnemonic = decryptMnemonic(MASTER, w.encrypted_mnemonic);
      const wordsArr = mnemonic.split(' ');
      const { publicKey, secretKey } = await mnemonicToPrivateKey(wordsArr);
      const wallet = WalletContractV4.create({ workchain: 0, publicKey });

      let toAddr: Address;
      try {
        toAddr = Address.parse(to);
      } catch {
        return reply.code(400).send({ error: 'bad_to' });
      }

      const client = new (TonClient as any)({ endpoint: TON_RPC, apiKey: TON_API_KEY });
      const opened = (client as any).open(wallet);
      const value = (toNano as any)(amount_ton);
      const body = comment ? (beginCell as any)().storeUint(0, 32).storeStringTail(comment).endCell() : undefined;

      const seqno = await opened.getSeqno();
      const transfer = await opened.createTransfer({
        seqno,
        secretKey,
        messages: [
          (internal as any)({ to: toAddr, value, bounce: true, body }),
        ],
      });
      await opened.send(transfer);

      return reply.send({ ok: true });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      console.error('POST /transfer error:', err?.message, err?.stack);
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // POST /wallets/:id/seed — выдать сид после подтверждения
  const SeedDto = z.object({ user_id: z.coerce.number().int().nonnegative(), confirm: z.boolean() });
  app.post('/wallets/:id/seed', async (req, reply) => {
    try {
      const id = Number((req.params as any)?.id);
      if (!id) return reply.code(400).send({ error: 'id required' });
      const { user_id, confirm } = SeedDto.parse((req.body ?? {}) as any);
      if (!confirm) return reply.code(400).send({ error: 'confirm_required' });
      const w = await getWalletSecretById(id);
      if (!w || Number((w as any).user_id) !== user_id) return reply.code(404).send({ error: 'not_found' });
      if (!raw || !MASTER || MASTER.length !== 32) return reply.code(500).send({ error: 'server_misconfiguration' });
      const mnemonic = decryptMnemonic(MASTER, w.encrypted_mnemonic);
      return reply.send({ mnemonic });
    } catch (err: any) {
      if (err?.issues) return reply.code(400).send({ error: 'bad_request' });
      return reply.code(500).send({ error: 'internal' });
    }
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n✅ wallet-api listening on http://localhost:${PORT}`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
