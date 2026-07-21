import { test, expect } from "vitest";
import {
  sealXChaCha20Poly1305,
  openXChaCha20Poly1305,
  decryptXChaCha20Poly1305,
  XCHACHA20_POLY1305_NONCE_BYTES,
} from "./xchacha";

const key = () => new Uint8Array(32).fill(3);

test("seal then open round-trips the plaintext", () => {
  const plaintext = new TextEncoder().encode("hello team");
  const sealed = sealXChaCha20Poly1305(key(), plaintext);
  // Array.from avoids a jsdom quirk where TextEncoder's Uint8Array comes from
  // a different realm than globalThis.Uint8Array, which breaks toEqual.
  expect(Array.from(openXChaCha20Poly1305(key(), sealed))).toEqual(Array.from(plaintext));
});

test("sealed output prepends a 24-byte nonce", () => {
  const sealed = sealXChaCha20Poly1305(key(), new Uint8Array([1, 2, 3]));
  // nonce(24) + ciphertext(3) + poly1305 tag(16) = 43
  expect(sealed.length).toBe(XCHACHA20_POLY1305_NONCE_BYTES + 3 + 16);
});

test("key of wrong length throws", () => {
  expect(() => sealXChaCha20Poly1305(new Uint8Array(16), new Uint8Array(1))).toThrow(/32 bytes/);
});

test("nonce of wrong length throws on decrypt", () => {
  expect(() => decryptXChaCha20Poly1305(key(), new Uint8Array(10), new Uint8Array(20))).toThrow(/24 bytes/);
});

test("tampered ciphertext fails authentication", () => {
  const sealed = sealXChaCha20Poly1305(key(), new Uint8Array([9, 9, 9]));
  sealed[sealed.length - 1] ^= 0xff; // flip a tag byte
  expect(() => openXChaCha20Poly1305(key(), sealed)).toThrow();
});
