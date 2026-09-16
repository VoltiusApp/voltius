import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI } from "@/plugins/api";

const getManifest = vi.fn();

vi.mock("./gist-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gist-api")>()),
  getManifest: (...args: unknown[]) => getManifest(...args),
  patchFiles: vi.fn(async () => {}),
  getDeviceBlobs: vi.fn(async () => []),
}));

const { GistApiError } = await import("./gist-api");
const engine = await import("./sync-engine");

function makeApi() {
  const store = new Map<string, unknown>([
    ["registeredGists", [{ id: "g1", addedAt: "2026-01-01T00:00:00Z" }]],
    ["importSourceId", "g1"],
    ["exportDestinationIds", ["g1"]],
    ["deviceId", "dev-1"],
  ]);
  const api = {
    vault: { get: vi.fn(async (k: string) => (k === "pat" ? "pat-token" : null)) },
    storage: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
      delete: vi.fn(async () => {}),
    },
    ui: { publishState: vi.fn() },
    crypto: { deriveKey: vi.fn(async () => "a".repeat(64)) },
    sync: { exportState: vi.fn(async () => "blob"), importStates: vi.fn(async () => {}) },
    http: {},
    notifications: { toast: vi.fn(), banner: vi.fn(), progress: vi.fn() },
  } as unknown as PluginAPI;
  return { api };
}

const manifest = { schema: 1, salt: "00", devices: [] };

describe("gist-sync engine notifications", () => {
  let api: PluginAPI;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ api } = makeApi());
    engine.init(api);
    getManifest.mockResolvedValue(manifest);
    await engine.syncNow();
  });

  afterEach(() => vi.restoreAllMocks());

  const setOnline = (online: boolean) =>
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);

  test("repeated transient failures publish error state without any notification", async () => {
    setOnline(true);
    getManifest.mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 4; i++) await engine.syncNow();

    expect(engine.getGistSyncState()).toMatchObject({ status: "error", error: "boom" });
    expect(api.notifications.toast).not.toHaveBeenCalled();
    expect(api.notifications.banner).not.toHaveBeenCalled();
  });

  test("an offline failure publishes offline state without any notification", async () => {
    setOnline(false);
    getManifest.mockRejectedValue(new Error("network"));
    await engine.syncNow();

    expect(engine.getGistSyncState().status).toBe("offline");
    expect(api.notifications.toast).not.toHaveBeenCalled();
    expect(api.notifications.banner).not.toHaveBeenCalled();
  });

  test("a successful sync shows no notification", async () => {
    await engine.syncNow();

    expect(engine.getGistSyncState().status).toBe("success");
    expect(api.notifications.toast).not.toHaveBeenCalled();
    expect(api.notifications.progress).not.toHaveBeenCalled();
  });

  test("an invalid PAT publishes the error and stops, without any notification", async () => {
    getManifest.mockRejectedValue(new GistApiError(401, "Bad credentials"));
    await engine.syncNow();

    expect(engine.getGistSyncState()).toMatchObject({ status: "error", error: "GitHub PAT is invalid or expired" });
    expect(api.notifications.banner).not.toHaveBeenCalled();
    expect(api.notifications.toast).not.toHaveBeenCalled();
  });
});
