import { describe, expect, it } from "vitest";
import { detectKeyInfo } from "./keyDetection";

const fixtures = import.meta.glob("/src-tauri/src/commands/fixtures/*.ppk", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const fixture = (name: string) => fixtures[`/src-tauri/src/commands/fixtures/${name}`];

describe("detectKeyInfo", () => {
  it("recognises PuTTY keys and their algorithm", () => {
    expect(detectKeyInfo(fixture("ed25519.ppk"), "")).toEqual({ type: "ED25519", valid: true });
    expect(detectKeyInfo(fixture("rsa-encrypted.ppk"), "")).toEqual({ type: "RSA", valid: true });
    expect(detectKeyInfo(fixture("ecdsa-v2.ppk"), "")).toEqual({ type: "ECDSA P-256", valid: true });
  });

  it("flags a PuTTY key cut off before its MAC line", () => {
    const truncated = fixture("ed25519.ppk").split("Private-MAC:")[0];
    expect(detectKeyInfo(truncated, "")).toEqual({ type: null, valid: false, errorKey: "keychain.keyForm.incompleteKey" });
  });
});
