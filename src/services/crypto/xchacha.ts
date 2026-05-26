import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

export const XCHACHA20_POLY1305_NONCE_BYTES = 24;
export const XCHACHA20_POLY1305_KEY_BYTES = 32;

export function encryptXChaCha20Poly1305(key: Uint8Array, plaintext: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } {
  if (key.length !== XCHACHA20_POLY1305_KEY_BYTES) throw new Error("key must be 32 bytes");
  const nonce = crypto.getRandomValues(new Uint8Array(XCHACHA20_POLY1305_NONCE_BYTES));
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return { nonce, ciphertext };
}

export function decryptXChaCha20Poly1305(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (key.length !== XCHACHA20_POLY1305_KEY_BYTES) throw new Error("key must be 32 bytes");
  if (nonce.length !== XCHACHA20_POLY1305_NONCE_BYTES) throw new Error("nonce must be 24 bytes");
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

export function sealXChaCha20Poly1305(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const { nonce, ciphertext } = encryptXChaCha20Poly1305(key, plaintext);
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
}

export function openXChaCha20Poly1305(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  const nonce = sealed.slice(0, XCHACHA20_POLY1305_NONCE_BYTES);
  const ciphertext = sealed.slice(XCHACHA20_POLY1305_NONCE_BYTES);
  return decryptXChaCha20Poly1305(key, nonce, ciphertext);
}
