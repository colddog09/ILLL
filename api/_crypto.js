import { webcrypto } from 'node:crypto';
const { subtle, getRandomValues } = webcrypto;

export async function deriveKey(userId) {
  const raw = await subtle.importKey(
    'raw',
    Buffer.from(process.env.SUPABASE_SERVICE_ROLE_KEY),
    'PBKDF2', false, ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(userId), iterations: 100_000 },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(key, obj) {
  const iv  = getRandomValues(new Uint8Array(12));
  const enc = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(obj))
  );
  return Buffer.concat([Buffer.from(iv), Buffer.from(enc)]).toString('base64');
}

export async function decryptJson(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  const dec = await subtle.decrypt(
    { name: 'AES-GCM', iv: buf.subarray(0, 12) },
    key,
    buf.subarray(12)
  );
  return JSON.parse(Buffer.from(dec).toString('utf8'));
}
