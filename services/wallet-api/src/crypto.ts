import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';

function hkdfSha256(master: Buffer, salt: Buffer, info: string, len = 32) {
  // упрощённый HKDF для DEV
  const prk = createHash('sha256').update(Buffer.concat([master, salt])).digest();
  const t = createHash('sha256').update(Buffer.concat([prk, Buffer.from(info), Buffer.from([1])])).digest();
  return t.subarray(0, len);
}

export function encryptMnemonic(masterKey: Buffer, mnemonic: string) {
  const salt = randomBytes(16);
  const recordKey = randomBytes(32);                // одноразовый ключ для конкретной записи
  const kek = hkdfSha256(masterKey, salt, 'enc-kek');

  const iv = randomBytes(12);
  const c1 = createCipheriv('aes-256-gcm', recordKey, iv);
  const ciphertext = Buffer.concat([c1.update(mnemonic, 'utf8'), c1.final()]);
  const tag = c1.getAuthTag();

  // шифруем recordKey key-encryption-key'ем (конвертное шифрование)
  const iv2 = randomBytes(12);
  const c2 = createCipheriv('aes-256-gcm', kek, iv2);
  const encRecordKeyBody = Buffer.concat([c2.update(recordKey), c2.final()]);
  const tag2 = c2.getAuthTag();

  // сохраняем iv2+tag2+encRecordKey одним base64
  const enc_record_key = Buffer.concat([iv2, tag2, encRecordKeyBody]).toString('base64');

  // Возвращаем компактную строку (base64(JSON)), чтобы хранить в одном TEXT поле
  const payload = {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64'),
    enc_record_key,
    kdf: 'hkdf-sha256:v1',
    alg: 'aes-256-gcm',
    v: 1,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decryptMnemonic(masterKey: Buffer, encBase64Json: string) {
  const json = Buffer.from(encBase64Json, 'base64').toString('utf8');
  const payload = JSON.parse(json) as {
    ciphertext: string;
    iv: string;
    tag: string;
    salt: string;
    enc_record_key: string;
    kdf: string;
    alg: string;
    v: number;
  };

  if (payload.kdf !== 'hkdf-sha256:v1' || payload.alg !== 'aes-256-gcm') {
    throw new Error('unsupported_encryption');
  }
  const salt = Buffer.from(payload.salt, 'base64');
  const kek = hkdfSha256(masterKey, salt, 'enc-kek');

  const enc = Buffer.from(payload.enc_record_key, 'base64');
  const iv2 = enc.subarray(0, 12);
  const tag2 = enc.subarray(12, 28);
  const body = enc.subarray(28);
  const d2 = createDecipheriv('aes-256-gcm', kek, iv2);
  d2.setAuthTag(tag2);
  const recordKey = Buffer.concat([d2.update(body), d2.final()]);

  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const d1 = createDecipheriv('aes-256-gcm', recordKey, iv);
  d1.setAuthTag(tag);
  const mnemonic = Buffer.concat([d1.update(ciphertext), d1.final()]).toString('utf8');
  return mnemonic;
}
