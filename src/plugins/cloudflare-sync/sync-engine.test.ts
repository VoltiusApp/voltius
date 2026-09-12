import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PluginAPI } from "@/plugins/api";

vi.mock("./worker-api", async () => {
  const actual = await vi.importActual<typeof import("./worker-api")>("./worker-api");
  return {
    ...actual,
    getManifest: vi.fn(),
    putManifest: vi.fn(),
    putDeviceBlob: vi.fn(),
    getDeviceBlobs: vi.fn(),
    deleteDevice: vi.fn(),
  };
});

import * as workerApi from "./worker-api";
import {
  init,
  isConfigured,
  setupNewVault,
  linkExistingVault,
  push,
  pull,
  syncNow,
  disconnect,
} from "./sync-engine";

const salt = "0123456789abcdef0123456789abcdef";

function makeApi() {
  const storage = new Map<string, unknown>();
  const vault = new Map<string, string>();
  const api = {
    http: { stream: vi.fn() },
    vault: {
      get: vi.fn(async (k: string) => vault.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        vault.set(k, v);
      }),
      delete: vi.fn(async (k: string) => {
        vault.delete(k);
      }),
    },
    storage: {
      get: vi.fn(async (k: string) => (storage.has(k) ? storage.get(k) : null)),
      set: vi.fn(async (k: string, v: unknown) => {
        storage.set(k, v);
      }),
      delete: vi.fn(async (k: string) => {
        storage.delete(k);
      }),
    },
    crypto: {
      deriveKey: vi.fn(async () => "a".repeat(64)),
    },
    sync: {
      exportState: vi.fn(async () => "exported-blob"),
      importStates: vi.fn(async () => {}),
    },
    ui: { publishState: vi.fn(), registerSettingsPage: vi.fn() },
    notifications: {
      toast: vi.fn(),
      banner: vi.fn(() => ({ dismiss: vi.fn() })),
      progress: vi.fn(() => ({ finish: vi.fn(), error: vi.fn() })),
    },
  } as unknown as PluginAPI;
  return { api, storage, vault };
}

describe("cloudflare-sync sync-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("isConfigured requires url + token + passphrase", async () => {
    const { api } = makeApi();
    init(api);
    expect(await isConfigured()).toBe(false);
  });

  test("setupNewVault writes manifest and device blob", async () => {
    const { api, vault, storage } = makeApi();
    init(api);
    vi.mocked(workerApi.putManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [],
    });
    vi.mocked(workerApi.putDeviceBlob).mockResolvedValue();

    await setupNewVault("https://sync.example.com/", "tok", "pass");

    expect(storage.get("workerUrl")).toBe("https://sync.example.com");
    expect(vault.get("syncToken")).toBe("tok");
    expect(vault.get("passphrase")).toBe("pass");
    expect(workerApi.putManifest).toHaveBeenCalled();
    expect(workerApi.putDeviceBlob).toHaveBeenCalled();
    expect(api.sync.exportState).toHaveBeenCalled();
    expect(await isConfigured()).toBe(true);
  });

  test("linkExistingVault validates manifest then stores secrets", async () => {
    const { api } = makeApi();
    init(api);
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [],
    });
    await linkExistingVault("https://sync.example.com", "tok", "pass");
    expect(workerApi.getManifest).toHaveBeenCalled();
    expect(await isConfigured()).toBe(true);
  });

  test("push exports and uploads device blob", async () => {
    const { api, storage, vault } = makeApi();
    init(api);
    storage.set("workerUrl", "https://sync.example.com");
    vault.set("syncToken", "tok");
    vault.set("passphrase", "pass");
    storage.set("deviceId", "dev-local");
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [{ id: "dev-local", label: "x", pushedAt: "t0" }],
    });
    vi.mocked(workerApi.putDeviceBlob).mockResolvedValue();

    await push();
    expect(api.sync.exportState).toHaveBeenCalled();
    expect(workerApi.putDeviceBlob).toHaveBeenCalled();
  });

  test("pull imports only changed remote devices", async () => {
    const { api, storage, vault } = makeApi();
    init(api);
    storage.set("workerUrl", "https://sync.example.com");
    vault.set("syncToken", "tok");
    vault.set("passphrase", "pass");
    storage.set("deviceId", "dev-local");
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [
        { id: "dev-local", label: "me", pushedAt: "t0" },
        { id: "dev-remote", label: "other", pushedAt: "t1" },
      ],
    });
    vi.mocked(workerApi.getDeviceBlobs).mockResolvedValue(["remote-blob"]);

    const changed = await pull();
    expect(changed).toBe(true);
    expect(api.sync.importStates).toHaveBeenCalledWith("a".repeat(64), ["remote-blob"]);
  });

  test("syncNow pull then push on success", async () => {
    const { api, storage, vault } = makeApi();
    init(api);
    storage.set("workerUrl", "https://sync.example.com");
    vault.set("syncToken", "tok");
    vault.set("passphrase", "pass");
    storage.set("deviceId", "dev-local");
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [{ id: "dev-local", label: "me", pushedAt: "t0" }],
    });
    vi.mocked(workerApi.getDeviceBlobs).mockResolvedValue([]);
    vi.mocked(workerApi.putDeviceBlob).mockResolvedValue();

    await syncNow();
    expect(workerApi.putDeviceBlob).toHaveBeenCalled();
  });

  test("disconnect clears secrets", async () => {
    const { api, storage, vault } = makeApi();
    init(api);
    storage.set("workerUrl", "https://sync.example.com");
    vault.set("syncToken", "tok");
    vault.set("passphrase", "pass");
    await disconnect();
    expect(await isConfigured()).toBe(false);
  });
});
