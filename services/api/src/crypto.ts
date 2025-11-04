import { randomBytes, createCipheriv, createHash } from 'crypto';

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

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64'),
    enc_record_key,
    kdf: 'hkdf-sha256:v1',
    alg: 'aes-256-gcm',
  };
}
