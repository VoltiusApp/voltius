// @vitest-environment jsdom
import { test, expect } from "vitest";
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

  expect(parsed.type).toBe("voltius-encrypted");
  expect(parsed.version).toBe(2);
  expect(parsed.cipher).toBe("xchacha20poly1305");
  expect(Uint8Array.from(atob(parsed.nonce), (c) => c.charCodeAt(0)).length).toBe(24);
  expect(await decryptText(encrypted, "correct horse battery staple")).toBe("voltius backup");
});
