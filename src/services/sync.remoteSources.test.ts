// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamDataManager", () => ({ onTeamLogin: vi.fn(async () => {}) }));

type SyncModule = typeof import("./sync");
type SourcesModule = typeof import("./remoteSources");
let sync: SyncModule;
let sources: SourcesModule["remoteSources"];

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const okJson = (body: unknown): Reply => ({ ok: true, status: 200, json: async () => body });
const status = (code: number): Reply => ({ ok: false, status: code, json: async () => ({}) });

let devices: Record<string, string>;
let listReply: (() => Reply) | null;
let blobReply: Record<string, () => Reply | Promise<Reply>>;
let decryptFails: Set<string>;

const emptyFiles = () => Object.fromEntries(sync.ENTITY_FILES.map((f) => [f, "[]"]));
const deviceOf = (blob: number[]) => String.fromCharCode(...blob);

function serve(): void {
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "keychain_get":
        if (args?.key === "server_url") return "https://sync.example.com";
        if (args?.key === "jwt") return jwt();
        if (args?.key === "account_id") return "account-1";
        return null;
      case "state_export_raw":
        return { files: emptyFiles(), secrets: {}, secret_clocks: {} };
      case "backup_decrypt":
        if (decryptFails.has(deviceOf(args?.blob as number[]))) throw "Decryption failed: aead::Error";
        return { files: emptyFiles(), secrets: {}, secret_clocks: {} };
      case "backup_export":
        return [];
      default:
        return cmd.endsWith("_list") ? [] : null;
    }
  });
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/sync/devices")) {
      if (listReply) return listReply();
      return okJson({ devices: Object.entries(devices).map(([device_id, updated_at]) => ({ device_id, metadata: {}, updated_at })) });
    }
    const pull = url.match(/\/v1\/sync\/blob\?device_id=(.+)$/);
    if (pull) {
      const id = decodeURIComponent(pull[1]);
      return blobReply[id]?.() ?? okJson({ blob: btoa(id) });
    }
    const del = url.match(/\/v1\/sync\/blob\/(.+)$/);
    if (del && init?.method === "DELETE") {
      delete devices[decodeURIComponent(del[1])];
      return { ok: true, status: 204, json: async () => ({}) };
    }
    if (url.endsWith("/v1/sync/blob") && init?.method === "PUT") return okJson({});
    return status(404);
  });
}

const stateOf = (id: string) => sources.list().find((s) => s.deviceId === id);
const pullsOf = (id: string) =>
  h.appFetch.mock.calls.filter(([url]) => String(url).endsWith(`/v1/sync/blob?device_id=${id}`)).length;

beforeEach(async () => {
  vi.resetModules();
  h.invoke.mockReset();
  h.appFetch.mockReset();
  sync = await import("./sync");
  ({ remoteSources: sources } = await import("./remoteSources"));
  const { setVaultKey } = await import("@/services/vault");
  const { useSubscriptionStore } = await import("@/stores/subscriptionStore");
  const { useSyncPrefsStore } = await import("@/stores/syncPrefsStore");
  useSubscriptionStore.setState({ isPro: true });
  useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], syncSettingDomains: {}, settingSyncOverrides: {}, paused: false });
  localStorage.setItem("voltius.device_id", "local-device");
  setVaultKey([1, 2, 3]);
  devices = { "local-device": "2030-01-01T00:00:00.000Z", laptop: "2030-01-01T00:00:00.000Z", desktop: "2030-01-01T00:00:00.000Z" };
  listReply = null;
  blobReply = {};
  decryptFails = new Set();
  serve();
});

test("every remote device synced is a plain success, and this device is not listed", async () => {
  await sync.syncNow();
  expect(sync.getSyncState().status).toBe("success");
  expect(sources.list().map((s) => [s.deviceId, s.state]).sort()).toEqual([["desktop", "synced"], ["laptop", "synced"]]);
});

test("one device failing to download leaves the others merged and the sync partial", async () => {
  blobReply.desktop = () => status(500);
  await sync.syncNow();
  expect(stateOf("laptop")?.state).toBe("synced");
  expect(stateOf("desktop")).toMatchObject({ state: "unavailable", httpStatus: 500 });
  expect(sync.getSyncState().status).toBe("partial");
  expect(sync.getSyncState().lastSync).not.toBeNull();
});

test.each([502, 503])("a proxy answering %i for one blob is recorded as unavailable", async (code) => {
  blobReply.desktop = () => status(code);
  await sync.syncNow();
  expect(stateOf("desktop")).toMatchObject({ state: "unavailable", httpStatus: code });
  expect(sync.getSyncState().status).toBe("partial");
});

test("a blob deleted between the list and the download drops its device", async () => {
  blobReply.desktop = () => status(404);
  await sync.syncNow();
  expect(stateOf("desktop")).toBeUndefined();
  expect(sync.getSyncState().status).toBe("success");
});

test("a blob no key opens is undecryptable and not downloaded again on its own", async () => {
  decryptFails.add("desktop");
  await sync.syncNow();
  expect(stateOf("desktop")?.state).toBe("undecryptable");
  await sync.syncNow();
  expect(pullsOf("desktop")).toBe(1);
  expect(stateOf("desktop")?.state).toBe("undecryptable");
  expect(sync.getSyncState().status).toBe("partial");
});

test("retrying a settled undecryptable blob downloads it again", async () => {
  decryptFails.add("desktop");
  await sync.syncNow();
  decryptFails.clear();
  await sync.retryRemoteSources(["desktop"]);
  expect(pullsOf("desktop")).toBe(2);
  expect(stateOf("desktop")?.state).toBe("synced");
  expect(sync.getSyncState().status).toBe("success");
});

test("a device recovers once its blob downloads again", async () => {
  blobReply.desktop = () => status(503);
  await sync.syncNow();
  expect(sync.getSyncState().status).toBe("partial");
  delete blobReply.desktop;
  await sync.syncNow();
  expect(stateOf("desktop")?.state).toBe("synced");
  expect(stateOf("desktop")?.syncedAt).not.toBeNull();
  expect(sync.getSyncState().status).toBe("success");
});

test("the device list failing fails the sync and keeps the last results", async () => {
  blobReply.desktop = () => status(500);
  await sync.syncNow();
  listReply = () => status(500);
  await expect(sync.syncNow()).rejects.toThrow();
  expect(sync.getSyncState().status).toBe("error");
  expect(stateOf("desktop")?.state).toBe("unavailable");
});

test("an unchanged blob stays synced without being downloaded again", async () => {
  await sync.syncNow();
  await sync.syncNow();
  expect(pullsOf("laptop")).toBe(1);
  expect(stateOf("laptop")?.state).toBe("synced");
});

test("a device that pushes again is pending until it is merged", async () => {
  await sync.syncNow();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  blobReply.laptop = async () => { await gate; return okJson({ blob: btoa("laptop") }); };
  devices.laptop = "2030-01-02T00:00:00.000Z";
  const running = sync.syncNow();
  await vi.waitFor(() => expect(stateOf("laptop")?.state).toBe("pending"));
  release();
  await running;
  expect(stateOf("laptop")).toMatchObject({ state: "synced", remoteUpdatedAt: "2030-01-02T00:00:00.000Z" });
});

test("removing a broken device deletes its blob and ends the partial state", async () => {
  decryptFails.add("desktop");
  await sync.syncNow();
  await sync.removeRemoteSource("desktop");
  expect(h.appFetch.mock.calls.some(([url, init]) => String(url).endsWith("/v1/sync/blob/desktop") && init?.method === "DELETE")).toBe(true);
  expect(stateOf("desktop")).toBeUndefined();
  expect(sync.getSyncState().status).toBe("success");
});

test("the launch sync records every other device", async () => {
  blobReply.desktop = () => status(500);
  await sync.syncOnLogin();
  expect(stateOf("laptop")?.state).toBe("synced");
  expect(stateOf("desktop")?.state).toBe("unavailable");
  expect(stateOf("local-device")).toBeUndefined();
  expect(sync.getSyncState().status).toBe("partial");
});

test("switching accounts forgets every device result", async () => {
  await sync.syncNow();
  sync.haltSync();
  expect(sources.list()).toEqual([]);
  sync.resumeSync();
});
