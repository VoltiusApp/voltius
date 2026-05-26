import test from "node:test";
import assert from "node:assert/strict";
import { encryptText, decryptText } from "../src/services/import-export/formats.ts";

test("encrypted export uses XChaCha20-Poly1305 with a 24-byte nonce", async () => {
  const encrypted = await encryptText("voltius backup", "correct horse battery staple");
  const parsed = JSON.parse(encrypted) as {
    type: string;
    version: number;
    cipher: string;
    nonce: string;
    data: string;
  };

  assert.equal(parsed.type, "voltius-encrypted");
  assert.equal(parsed.version, 2);
  assert.equal(parsed.cipher, "xchacha20poly1305");
  assert.equal(Uint8Array.from(atob(parsed.nonce), (c) => c.charCodeAt(0)).length, 24);
  assert.equal(await decryptText(encrypted, "correct horse battery staple"), "voltius backup");
});
