// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamDataManager", () => ({ onTeamLogin: vi.fn(async () => {}) }));

type SyncModule = typeof import("./sync");
let sync: SyncModule;
let setVaultKey: (key: number[]) => void;
let setSyncPrefs: (prefs: { excludedIds: string[] }) => void;

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const notFound = { ok: false, status: 404, json: async () => ({}) };

let remoteUpdatedAt: string;
let remoteIds: string[];
let inFlightPulls: number;
let mostPullsAtOnce: number;
let decrypt: () => unknown;
let blobGate: Promise<void> | null;

const emptyFiles = () => Object.fromEntries(sync.ENTITY_FILES.map((f) => [f, "[]"]));
const remoteWithConnection = () => ({
  files: { ...emptyFiles(), "connections.json": JSON.stringify([{ id: "c1", name: "web", updated_at: "2026-02-01T00:00:00.000Z", clocks: {} }]) },
  secrets: {},
  secret_clocks: {},
});

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
        return decrypt();
      case "backup_export":
        return [];
      default:
        return cmd.endsWith("_list") ? [] : null;
    }
  });
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/sync/devices")) {
      return okJson({ devices: remoteIds.map((device_id) => ({ device_id, metadata: {}, updated_at: remoteUpdatedAt })) });
    }
    if (url.includes("/v1/sync/blob?device_id=")) {
      mostPullsAtOnce = Math.max(mostPullsAtOnce, ++inFlightPulls);
      await blobGate;
      await new Promise((r) => setTimeout(r, 5));
      inFlightPulls--;
      return okJson({ blob: btoa("x") });
    }
    if (url.endsWith("/v1/sync/blob") && init?.method === "PUT") return okJson({});
    return notFound;
  });
}

const calls = (match: (url: string, init?: RequestInit) => boolean) =>
  h.appFetch.mock.calls.filter(([url, init]) => match(String(url), init)).length;
const blobPulls = () => calls((url) => url.includes("/v1/sync/blob?device_id=remote-1"));
const deviceLists = () => calls((url) => url.endsWith("/v1/sync/devices"));
const blobPushes = () => calls((url, init) => url.endsWith("/v1/sync/blob") && init?.method === "PUT");

beforeEach(async () => {
  vi.resetModules();
  h.invoke.mockReset();
  h.appFetch.mockReset();
  sync = await import("./sync");
  ({ setVaultKey } = await import("@/services/vault"));
  const { useSubscriptionStore } = await import("@/stores/subscriptionStore");
  const { useSyncPrefsStore } = await import("@/stores/syncPrefsStore");
  useSubscriptionStore.setState({ isPro: true });
  useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], syncSettingDomains: {}, settingSyncOverrides: {}, paused: false });
  setSyncPrefs = (prefs) => useSyncPrefsStore.setState(prefs);
  localStorage.setItem("voltius.device_id", "local-device");
  setVaultKey([1, 2, 3]);
  remoteUpdatedAt = "2030-01-01T00:00:00.000Z";
  remoteIds = ["remote-1"];
  inFlightPulls = 0;
  mostPullsAtOnce = 0;
  decrypt = remoteWithConnection;
  blobGate = null;
  serve();
});

test("a sync does not download a remote blob it already merged", async () => {
  await sync.syncNow();
  await sync.syncNow();
  expect(blobPulls()).toBe(1);
});

test("a remote blob is downloaded again once its device pushes", async () => {
  await sync.syncNow();
  remoteUpdatedAt = "2030-01-02T00:00:00.000Z";
  await sync.syncNow();
  expect(blobPulls()).toBe(2);
});

test("changing what this device syncs downloads every blob again", async () => {
  await sync.syncNow();
  setSyncPrefs({ excludedIds: ["c1"] });
  await sync.syncNow();
  expect(blobPulls()).toBe(2);
});

test("swapping out the session's local data downloads every blob again", async () => {
  await sync.syncNow();
  sync.haltSync();
  sync.resumeSync();
  await sync.syncNow();
  expect(blobPulls()).toBe(2);
});

test("an undecryptable blob is downloaded again only once the keys change", async () => {
  decrypt = () => { throw "Decryption failed: aead::Error"; };
  await sync.syncNow();
  await sync.syncNow();
  expect(blobPulls()).toBe(1);
  setVaultKey([4, 5, 6]);
  await sync.syncNow();
  expect(blobPulls()).toBe(2);
});

test("a failed merge leaves the blob to be downloaded again", async () => {
  decrypt = () => { throw new Error("Blob malformed"); };
  await sync.syncNow();
  await sync.syncNow();
  expect(blobPulls()).toBe(2);
});

test("a remote push announced during a sync runs another sync after it", async () => {
  let release!: () => void;
  blobGate = new Promise((r) => { release = r; });
  const first = sync.syncNow();
  await vi.waitFor(() => expect(blobPulls()).toBe(1));
  await sync.syncNow();
  release();
  await first;
  await vi.waitFor(() => expect(deviceLists()).toBe(2), { timeout: 3000 });
});

test("a local change made during a sync that pushes nothing is pushed after it", async () => {
  decrypt = () => ({ files: emptyFiles(), secrets: {}, secret_clocks: {} });
  let release!: () => void;
  blobGate = new Promise((r) => { release = r; });
  const first = sync.syncNow();
  await vi.waitFor(() => expect(blobPulls()).toBe(1));
  await sync.syncNow(true);
  release();
  await first;
  expect(blobPushes()).toBe(0);
  await vi.waitFor(() => expect(blobPushes()).toBe(1), { timeout: 3000 });
});

test("the launch sync downloads several blobs at once", async () => {
  remoteIds = ["remote-1", "remote-2", "remote-3", "remote-4"];
  await sync.syncOnLogin();
  expect(calls((url) => url.includes("/v1/sync/blob?device_id="))).toBe(4);
  expect(mostPullsAtOnce).toBeGreaterThan(1);
});

test("the launch sync reads and writes local state once, however many devices it merges", async () => {
  remoteIds = ["remote-1", "remote-2", "remote-3"];
  await sync.syncOnLogin();
  const commands = h.invoke.mock.calls.map(([cmd]) => cmd);
  expect(commands.filter((c) => c === "state_export_raw")).toHaveLength(1);
  expect(commands.filter((c) => c === "state_import")).toHaveLength(1);
});
