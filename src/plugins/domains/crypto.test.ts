import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { createCryptoAPI } from "./crypto";

describe("createCryptoAPI", () => {
  beforeEach(() => invoke.mockReset());

  test("deriveKey forwards passphrase and salt to the backing command", async () => {
    invoke.mockResolvedValue("deadbeef");
    const api = createCryptoAPI();
    await expect(api.deriveKey("hunter2", "00ff")).resolves.toBe("deadbeef");
    expect(invoke).toHaveBeenCalledWith("derive_gist_key", {
      passphrase: "hunter2",
      saltHex: "00ff",
    });
  });
});
