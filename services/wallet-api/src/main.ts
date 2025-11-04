// services/wallet-api/src/main.ts
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { migrate, ensureUser, getWalletByUser, insertWallet } from './db';
import { encryptMnemonic } from './crypto';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';

const MASTER = process.env.MASTER_KEY_DEV
  ? Buffer.from(process.env.MASTER_KEY_DEV, 'base64')
  : null;

const PORT = Number(process.env.PORT || 8090);

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true }));

  app.addHook('onReady', async () => {
    await migrate();
    if (!MASTER) app.log.warn('MASTER_KEY_DEV is not set. Wallet encryption will fail.');
  });

  /**
   * POST /register
   * body: { user_id: string }
   * returns: { address: string }
   *
   * Behavior:
   * - если кошелёк уже есть для user_id -> возвращаем его
   * - если нет -> генерируем mnemonic, wallet address, шифруем (MASTER обязателен),
   *   пытаемся вставить в БД; при конфликте (гонка) повторно читаем и возвращаем существующий.
   */
  app.post('/register', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const user_id = typeof body.user_id === 'string' ? body.user_id.trim() : '';

      if (!user_id) {
        return reply.code(400).send({ error: 'user_id required' });
      }

      // 1) если уже есть — сразу возвращаем
      const existing = await getWalletByUser(user_id);
      if (existing) {
        return reply.send({ address: existing.address });
      }

      // 2) позаботься о записи user (если нужна)
      await ensureUser(user_id);

      // 3) генерируем mnemonic и адрес
      const wordsArr = await mnemonicNew(24);
      const words = wordsArr.join(' ');
      const { publicKey } = await mnemonicToPrivateKey(wordsArr);
      const wc = WalletContractV4.create({ workchain: 0, publicKey });
      const address = wc.address.toString();

      // 4) шифруем сид-фразу (требуется MASTER)
      if (!MASTER) {
        app.log.error('MASTER_KEY_DEV is not set — cannot encrypt mnemonic');
        return reply.code(500).send({ error: 'server misconfiguration' });
      }

      const enc = encryptMnemonic(MASTER, words);

      // 5) попытка вставки — оборачиваем в try/catch для обработки гонки
      try {
        await insertWallet({
          user_id,
          address,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          tag: enc.tag,
          salt: enc.salt,
          enc_record_key: enc.enc_record_key,
          kdf: enc.kdf,
          alg: enc.alg,
        });

        return reply.send({ address });
      } catch (e: any) {
        // возможен конфликт уникальности при параллельной вставке
        // pg unique violation -> code '23505'
        app.log.warn('insertWallet failed, will re-check existing wallet', e?.code ?? e?.message);
        if (e?.code === '23505') {
          const nowExists = await getWalletByUser(user_id);
          if (nowExists) return reply.send({ address: nowExists.address });
        }
        // иное — пробрасываем
        app.log.error('insertWallet error', e);
        return reply.code(500).send({ error: 'db insert failed' });
      }
    } catch (err: any) {
      app.log.error('register handler error', err?.message ?? err);
      return reply.code(500).send({ error: 'internal error' });
    }
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n✅ wallet-api listening on http://localhost:${PORT}`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
