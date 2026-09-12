import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PluginAPI } from "@/plugins/api";

vi.mock("./worker-api", async () => {
  const actual = await vi.importActual<typeof import("./worker-api")>("./worker-api");
  return {
    ...actual,
    getManifest: vi.fn(),
    getManifestWithEtag: vi.fn(),
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
  MAX_SYNC_CONFLICT_RETRIES,
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
    vi.mocked(workerApi.getManifestWithEtag).mockImplementation(async (...args) => ({
      manifest: await vi.mocked(workerApi.getManifest)(...args),
      etag: '"m1"',
    }));
  });

  test("isConfigured requires url + token + passphrase", async () => {
    const { api } = makeApi();
    init(api);
    expect(await isConfigured()).toBe(false);
  });

  test("setupNewVault writes manifest and device blob", async () => {
    const { api, vault, storage } = makeApi();
    init(api);
    vi.mocked(workerApi.getManifest).mockRejectedValue(
      new workerApi.WorkerApiError(404, "missing"),
    );
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


  test("setupNewVault refuses existing remote without overwrite", async () => {
    const { api } = makeApi();
    init(api);
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [],
    });
    await expect(setupNewVault("https://sync.example.com", "tok", "pass")).rejects.toThrow(
      /already exists/,
    );
    expect(workerApi.putManifest).not.toHaveBeenCalled();
  });

  test("setupNewVault overwrite replaces existing vault", async () => {
    const { api } = makeApi();
    init(api);
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [],
    });
    vi.mocked(workerApi.putManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [],
    });
    vi.mocked(workerApi.putDeviceBlob).mockResolvedValue();
    await setupNewVault("https://sync.example.com", "tok", "pass", { overwrite: true });
    expect(workerApi.putManifest).toHaveBeenCalled();
  });

  test("normalizeWorkerUrl rejects plain http remote hosts", async () => {
    const { normalizeWorkerUrl } = await import("./sync-engine");
    expect(() => normalizeWorkerUrl("http://evil.example.com")).toThrow(/https/);
    expect(normalizeWorkerUrl("https://ok.example.com/")).toBe("https://ok.example.com");
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
    expect(api.sync.importStates).not.toHaveBeenCalled();
  });

  test("linkExistingVault with no device blobs stores passphrase without probing", async () => {
    const { api } = makeApi();
    init(api);
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [{ id: "ghost", label: "gone", pushedAt: "t0" }],
    });
    vi.mocked(workerApi.getDeviceBlobs).mockResolvedValue([]);
    await linkExistingVault("https://sync.example.com", "tok", "pass");
    expect(api.sync.importStates).not.toHaveBeenCalled();
    expect(await isConfigured()).toBe(true);
  });

  test("linkExistingVault rejects a wrong passphrase and rolls back secrets", async () => {
    const { api, vault, storage } = makeApi();
    init(api);
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [{ id: "dev-remote", label: "other", pushedAt: "t1" }],
    });
    vi.mocked(workerApi.getDeviceBlobs).mockResolvedValue(["cipher-blob"]);
    vi.mocked(api.sync.importStates).mockRejectedValue(new Error("Decryption failed — wrong key or corrupted blob"));

    await expect(linkExistingVault("https://sync.example.com", "tok", "wrong-pass")).rejects.toThrow(
      /passphrase does not match/,
    );
    expect(await isConfigured()).toBe(false);
    expect(vault.get("passphrase")).toBeUndefined();
    expect(vault.get("syncToken")).toBeUndefined();
    expect(storage.get("workerUrl")).toBeUndefined();
  });

  test("linkExistingVault with a valid passphrase probes then stays configured", async () => {
    const { api, vault } = makeApi();
    init(api);
    vi.mocked(workerApi.getManifest).mockResolvedValue({
      schema: 1,
      salt,
      devices: [{ id: "dev-remote", label: "other", pushedAt: "t1" }],
    });
    vi.mocked(workerApi.getDeviceBlobs).mockResolvedValue(["cipher-blob"]);
    await linkExistingVault("https://sync.example.com", "tok", "pass");
    expect(api.sync.importStates).toHaveBeenCalledWith("a".repeat(64), ["cipher-blob"]);
    expect(vault.get("passphrase")).toBe("pass");
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
    expect(vi.mocked(workerApi.putDeviceBlob).mock.calls[0][5]).toEqual({ ifMatch: '"m1"' });
  });

  test("syncNow retries pull+push on 412 then succeeds", async () => {
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
    vi.mocked(workerApi.putDeviceBlob)
      .mockRejectedValueOnce(new workerApi.WorkerApiError(412, "etag mismatch"))
      .mockResolvedValueOnce(undefined);

    await syncNow();
    expect(workerApi.putDeviceBlob).toHaveBeenCalledTimes(2);
  });

  test("syncNow surfaces a clear error after exhausting conflict retries", async () => {
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
    vi.mocked(workerApi.putDeviceBlob).mockRejectedValue(
      new workerApi.WorkerApiError(412, "etag mismatch"),
    );

    await syncNow();
    expect(workerApi.putDeviceBlob).toHaveBeenCalledTimes(MAX_SYNC_CONFLICT_RETRIES + 1);
    expect(api.ui.publishState).toHaveBeenCalled();
    const last = vi.mocked(api.ui.publishState).mock.calls.at(-1)?.[1] as { status: string; error: string | null };
    expect(last.status).toBe("error");
    expect(last.error).toMatch(/Remote changed during sync/);
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
