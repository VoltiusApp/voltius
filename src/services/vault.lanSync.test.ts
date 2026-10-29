// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), hangStart: false, failStop: false }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamDataManager", () => ({ onSessionEnd: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: async () => true }));
vi.mock("@/services/lanSyncIntro", () => ({ ensureLanSyncIntro: async () => {} }));
vi.mock("@/services/sync", () => ({
  ENTITY_FILES: [],
  parseEntities: () => [],
  getDeviceId: async () => "self",
  onRemotePayloadMerged: () => () => {},
  onLocalMutation: () => () => {},
  sessionBlobKeys: () => [[1]],
  exportLocalBlob: async () => [7],
  openRemoteBlob: async () => ({ files: {}, secrets: {} }),
  startRealtimeSync: () => {},
}));

import { lockVault, resetVault, setVaultKey } from "./vault";
import { startLanSync } from "./lanSync";
import { LAN_SYNC_DEVICES_KEY, useLanSyncStore } from "@/stores/lanSyncStore";

const order = () => h.invoke.mock.calls.map(([c]) => c as string);

beforeEach(async () => {
  h.hangStart = false;
  h.failStop = false;
  h.invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === "lan_sync_start" && h.hangStart) return new Promise(() => {});
    if (cmd === "lan_sync_stop" && h.failStop) return Promise.reject(new Error("stop failed"));
    return Promise.resolve(cmd === "device_hostname" ? "host" : undefined);
  });
  setVaultKey([1]);
});

test("resetVault locks, stops lan sync, then wipes", async () => {
  await startLanSync();
  await resetVault();
  const seq = order().filter((c) => ["secrets_lock", "lan_sync_stop", "vault_reset"].includes(c));
  expect(seq).toEqual(["secrets_lock", "lan_sync_stop", "vault_reset"]);
});

test("resetVault leaves none of the account's nearby devices behind", async () => {
  await startLanSync();
  const peer = { deviceId: "d1", deviceName: "One", platform: "linux", route: "lan" as const, address: "a" };
  useLanSyncStore.getState().rememberDevice(peer);
  useLanSyncStore.getState().setPeers([peer]);
  await resetVault();
  expect(localStorage.getItem(LAN_SYNC_DEVICES_KEY)).toBeNull();
  expect(useLanSyncStore.getState().known).toEqual({});
});

test("a failing lan stop never fails or skips the lock", async () => {
  h.failStop = true;
  await startLanSync();
  await expect(lockVault()).resolves.toBeUndefined();
  expect(order()).toContain("secrets_lock");
});

// Last: the hung start keeps the lifecycle queue busy for the rest of the module.
test("lockVault locks the secrets store even while lan_sync_start never resolves", async () => {
  h.hangStart = true;
  void startLanSync();
  await vi.waitFor(() => expect(order()).toContain("lan_sync_start"));
  const locking = lockVault();
  await vi.waitFor(() => expect(order()).toContain("secrets_lock"));
  await locking;
  expect(order()).not.toContain("lan_sync_stop");
}, 10_000);
