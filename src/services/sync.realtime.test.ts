// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";

type Connect = (signal: AbortSignal, onOpen: () => void) => Promise<void>;

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  connects: [] as AbortSignal[],
  connect: undefined as unknown as Connect,
  events: new Map<string, () => void>(),
}));

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
  connectNativeSse: (_url: string, _headers: unknown, signal: AbortSignal, _onChunk: unknown, onOpen: () => void) => {
    h.connects.push(signal);
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
} from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { setVaultKey } from "@/services/vault";

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

const unreachable: Connect = async () => { throw new Error("error sending request"); };
const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
const staysOpen: Connect = (signal, onOpen) => {
  onOpen();
  return untilAborted(signal);
};
const opensThenDrops: Connect = async (_signal, onOpen) => { onOpen(); };

const deviceListFetches = () => h.appFetch.mock.calls.filter(([url]) => String(url).endsWith("/v1/sync/devices")).length;

let syncRuns = 0;
let unwatch = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  h.connects.length = 0;
  h.connect = unreachable;
  h.events.clear();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd !== "keychain_get") return null;
    if (args?.key === "server_url") return "https://sync.example.com";
    if (args?.key === "jwt") return jwt();
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

  const run = syncNow(true).catch(() => {});
  await vi.advanceTimersByTimeAsync(1_000);
  await run;

  expect(syncRuns).toBe(1);
});
