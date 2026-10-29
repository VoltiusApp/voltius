// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";

type Connect = (signal: AbortSignal, onOpen: () => void) => Promise<void>;

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  connects: [] as AbortSignal[],
  connect: undefined as unknown as Connect,
  events: new Map<string, () => void>(),
  chunk: (() => {}) as (text: string) => void,
  settle: vi.fn(async () => {}),
}));
vi.mock("@/services/account", async (orig) => ({ ...(await orig<object>()), settleVaultOnDek: h.settle }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    h.events.set(event, handler);
    return () => { h.events.delete(event); };
  }),
}));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamDataManager", () => ({ onTeamLogin: vi.fn(async () => {}) }));
vi.mock("@/services/nativeSseStream", () => ({
  connectNativeSse: (_url: string, _headers: unknown, signal: AbortSignal, onChunk: (text: string) => void, onOpen: () => void) => {
    h.connects.push(signal);
    h.chunk = onChunk;
    return h.connect(signal, onOpen);
  },
}));

import {
  getSyncState,
  onSyncStateChange,
  scheduleSync,
  setSyncPaused,
  startRealtimeSync,
  stopRealtimeSync,
  syncInBackground,
  syncNow,
  syncOnLaunch,
  syncOnLogin,
} from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { setVaultKey } from "@/services/vault";
import { UnreachableError } from "@/services/reachability";

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

const unreachable: Connect = async () => { throw new UnreachableError("error sending request"); };
const originDown: Connect = async () => { throw new UnreachableError("HTTP 504", 504); };
const refused: Connect = async () => { throw new Error("HTTP 500: "); };
const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
const staysOpen: Connect = (signal, onOpen) => {
  onOpen();
  return untilAborted(signal);
};
const opensThenDrops: Connect = async (_signal, onOpen) => { onOpen(); };

const blobPushes = () => h.appFetch.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/sync/blob") && init?.method === "PUT").length;
const emptyAnswer = (url: string) =>
  url.endsWith("/v1/sync/devices") ? JSON.stringify({ devices: [] }) : url.includes("/teams") ? "[]" : "{}";
const serverAnswers = () => h.appFetch.mockImplementation(async (url: string) => new Response(emptyAnswer(String(url)), { status: 200 }));

async function runSync(forcePush = false) {
  const run = syncNow(forcePush).catch(() => {});
  await vi.advanceTimersByTimeAsync(1_000);
  await run;
}

const deviceListFetches = () => h.appFetch.mock.calls.filter(([url]) => String(url).endsWith("/v1/sync/devices")).length;

let syncRuns = 0;
let unwatch = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  h.connects.length = 0;
  h.settle.mockReset().mockResolvedValue(undefined);
  h.connect = unreachable;
  h.events.clear();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "backup_export") return [1, 2, 3];
    if (cmd.endsWith("_list")) return [];
    if (cmd !== "keychain_get") return null;
    if (args?.key === "server_url") return "https://sync.example.com";
    if (args?.key === "jwt") return jwt();
    if (args?.key === "account_id") return "account-1";
    return null;
  });
  h.appFetch.mockReset();
  h.appFetch.mockRejectedValue(new Error("error sending request"));
  useSubscriptionStore.setState({ isPro: true });
  setVaultKey([1, 2, 3]);
  useSyncPrefsStore.setState({ paused: false });
  syncRuns = 0;
  unwatch = onSyncStateChange(() => {
    if (getSyncState().status === "syncing") syncRuns++;
  });
});

afterEach(async () => {
  stopRealtimeSync();
  useSyncPrefsStore.setState({ paused: false });
  await vi.advanceTimersByTimeAsync(5_000);
  unwatch();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("an unreachable server is retried at a growing interval", async () => {
  startRealtimeSync();

  await vi.advanceTimersByTimeAsync(34_000);
  expect(h.connects).toHaveLength(3);

  await vi.advanceTimersByTimeAsync(2_000);
  expect(h.connects).toHaveLength(4);
});

test("no sync is attempted while the stream cannot open", async () => {
  startRealtimeSync();

  await vi.advanceTimersByTimeAsync(60_000);

  expect(syncRuns).toBe(0);
});

test("an opened stream catches up with a sync", async () => {
  h.connect = staysOpen;

  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(0);

  expect(syncRuns).toBe(1);
});

test("the network coming back cuts the wait short", async () => {
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(h.connects).toHaveLength(3);

  h.events.get("network-changed")?.();
  await vi.advanceTimersByTimeAsync(0);

  expect(h.connects).toHaveLength(4);
});

test("a proxy answering for a server that is down is retried at most every 30 s", async () => {
  h.connect = originDown;
  startRealtimeSync();

  await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 30_000 + 1_000);
  expect(h.connects).toHaveLength(5);

  await vi.advanceTimersByTimeAsync(30_000);
  expect(h.connects).toHaveLength(6);
});

test("a sync the proxy answered for a down server shortens the retries too", async () => {
  h.connect = staysOpen;
  h.appFetch.mockImplementation(async () => new Response("", { status: 504 }));

  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 30_000 + 30_000 + 1_000);

  expect(h.connects).toHaveLength(6);
});

test("an edit made while the stream waits to retry tries the server right away", async () => {
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(36_000);
  expect(h.connects).toHaveLength(4);

  h.connect = staysOpen;
  serverAnswers();
  scheduleSync();
  await vi.advanceTimersByTimeAsync(3_000);

  expect(h.connects).toHaveLength(5);
  expect(blobPushes()).toBe(1);
  expect(getSyncState().status).toBe("success");
});

test("a sync the user asked for reopens a stream that waits to retry", async () => {
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(36_000);
  expect(h.connects).toHaveLength(4);

  h.connect = staysOpen;
  serverAnswers();
  await runSync();

  expect(h.connects).toHaveLength(5);
  expect(h.connects[4].aborted).toBe(false);
});

test("a stream that drops as soon as it opens is not reopened by its own catch-up sync", async () => {
  h.connect = opensThenDrops;
  serverAnswers();

  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(4_000);

  expect(h.connects).toHaveLength(1);
});

test("a stream that opened and then dropped is retried at the shortest wait", async () => {
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(14_000);
  expect(h.connects).toHaveLength(2);

  h.connect = opensThenDrops;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(h.connects).toHaveLength(3);

  h.connect = unreachable;
  await vi.advanceTimersByTimeAsync(5_500);
  expect(h.connects).toHaveLength(4);
});

test("a paused device opens no stream", async () => {
  setSyncPaused(true);

  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(60_000);

  expect(h.connects).toHaveLength(0);
});

test("pausing closes the live stream and stops the retries", async () => {
  h.connect = staysOpen;
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(0);

  setSyncPaused(true);
  await vi.advanceTimersByTimeAsync(600_000);

  expect(h.connects).toHaveLength(1);
  expect(h.connects[0].aborted).toBe(true);
});

test("resuming reopens the stream and runs the sync the launch skipped", async () => {
  setSyncPaused(true);
  await syncOnLaunch();
  expect(deviceListFetches()).toBe(0);

  setSyncPaused(false);
  await vi.advanceTimersByTimeAsync(0);

  expect(h.connects).toHaveLength(1);
  expect(deviceListFetches()).toBe(1);
});

test("a device that is not paused syncs on launch", async () => {
  await syncOnLaunch();

  expect(deviceListFetches()).toBe(1);
});

test("an edit made while paused is not pushed", async () => {
  setSyncPaused(true);

  scheduleSync();
  await vi.advanceTimersByTimeAsync(5_000);

  expect(syncRuns).toBe(0);
});

test("an edit debounced just before pausing is not pushed either", async () => {
  scheduleSync();
  setSyncPaused(true);

  await vi.advanceTimersByTimeAsync(5_000);

  expect(syncRuns).toBe(0);
});

test("a background sync is skipped while paused", async () => {
  setSyncPaused(true);

  await syncInBackground(true);

  expect(syncRuns).toBe(0);
});

test("a sync the user asked for still runs while paused", async () => {
  setSyncPaused(true);

  await runSync(true);

  expect(syncRuns).toBe(1);
});

test("a server that cannot be reached shows as offline with the reason, not as an error", async () => {
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(0);

  expect(getSyncState()).toMatchObject({ status: "offline", error: "error sending request" });
});

test("a server that answers the stream with an error is not offline", async () => {
  h.connect = staysOpen;
  serverAnswers();
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(1_000);
  stopRealtimeSync();
  expect(getSyncState()).toMatchObject({ error: null, status: "success" });

  h.connect = refused;
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(0);

  expect(getSyncState().status).toBe("success");
});

test("a sync that gets no answer from the server reports offline", async () => {
  h.appFetch.mockRejectedValue("error sending request for url (https://sync.example.com/v1/sync/devices)");

  await runSync();

  expect(getSyncState()).toMatchObject({
    status: "offline",
    error: "error sending request for url (https://sync.example.com/v1/sync/devices)",
  });
});

test("a sync the proxy in front of the server answered reports offline", async () => {
  h.appFetch.mockImplementation(async () => new Response("", { status: 502 }));

  await runSync();

  expect(getSyncState().status).toBe("offline");
});

test("a sync the server itself turned down stays an error", async () => {
  h.appFetch.mockImplementation(async () => new Response("", { status: 429, headers: { "Retry-After": "5" } }));

  await runSync();

  expect(getSyncState().status).toBe("error");
});

test("an expired token that cannot be refreshed for lack of a server is offline too", async () => {
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd !== "keychain_get") return null;
    if (args?.key === "server_url") return "https://sync.example.com";
    if (args?.key === "refresh_token") return "refresh";
    return null;
  });
  h.appFetch.mockRejectedValue("error sending request");
  h.connect = staysOpen;

  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(0);

  expect(h.connects).toHaveLength(0);
  expect(getSyncState().status).toBe("offline");
});

test("an edit made while the server is unreachable sends nothing", async () => {
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(0);
  h.appFetch.mockClear();

  scheduleSync();
  await vi.advanceTimersByTimeAsync(4_000);

  expect(syncRuns).toBe(0);
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("that edit is pushed once the server answers again", async () => {
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(0);
  scheduleSync();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(blobPushes()).toBe(0);

  h.connect = staysOpen;
  serverAnswers();
  h.events.get("network-changed")?.();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(blobPushes()).toBe(1);
  expect(getSyncState().status).toBe("success");
});

test("a launch sync that found no server runs again once the stream opens", async () => {
  await syncOnLaunch();
  expect(getSyncState().status).toBe("offline");
  expect(blobPushes()).toBe(0);

  h.connect = staysOpen;
  serverAnswers();
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(blobPushes()).toBe(1);
  expect(getSyncState().status).toBe("success");
});

test("a stream that stays silent past the heartbeat is reopened", async () => {
  h.connect = staysOpen;
  serverAnswers();
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(74_000);
  expect(h.connects).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(2_000);
  expect(h.connects[0].aborted).toBe(true);

  await vi.advanceTimersByTimeAsync(6_000);
  expect(h.connects).toHaveLength(2);
});

test("a stream that keeps sending heartbeats is left alone", async () => {
  h.connect = staysOpen;
  serverAnswers();
  startRealtimeSync();

  for (let i = 0; i < 6; i++) {
    await vi.advanceTimersByTimeAsync(30_000);
    h.chunk(":heartbeat\n\n");
  }

  expect(h.connects).toHaveLength(1);
  expect(h.connects[0].aborted).toBe(false);
});

test("a sync that cannot reach the server drops a stream that still looks open", async () => {
  h.connect = staysOpen;
  serverAnswers();
  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(h.connects[0].aborted).toBe(false);

  h.appFetch.mockRejectedValue("error sending request");
  h.connect = unreachable;
  await runSync(true);

  expect(h.connects[0].aborted).toBe(true);
  expect(getSyncState().status).toBe("offline");
});

test("a stream whose catch-up sync keeps failing is retried at a growing interval", async () => {
  h.connect = staysOpen;
  h.appFetch.mockRejectedValue("error sending request");

  startRealtimeSync();
  await vi.advanceTimersByTimeAsync(34_000);

  expect(h.connects).toHaveLength(3);
});

test("a login settles the vault before the Pro and teams branching", async () => {
  useSubscriptionStore.setState({ isPro: false });
  await syncOnLogin();

  expect(h.settle).toHaveBeenCalledTimes(1);
});

test("a paused launch still settles the vault, once", async () => {
  setSyncPaused(true);
  await syncOnLaunch();

  expect(h.settle).toHaveBeenCalledTimes(1);
  expect(deviceListFetches()).toBe(0);
});

test("a launch that syncs settles the vault once", async () => {
  await syncOnLaunch();

  expect(h.settle).toHaveBeenCalledTimes(1);
});

test("a failing settle does not fail the sync", async () => {
  h.settle.mockRejectedValueOnce(new Error("rekey failed"));
  await expect(syncOnLogin()).resolves.toBeUndefined();
  expect(deviceListFetches()).toBe(1);
});
