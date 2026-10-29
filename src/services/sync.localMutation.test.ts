// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));

import { push, scheduleSync, resumeSync, onLocalMutation, onRemotePayloadMerged, mergeRemotePayload } from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { setVaultKey } from "@/services/vault";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";

const cleanups: (() => void)[] = [];
const track = (off: () => void) => { cleanups.push(off); return off; };
afterEach(() => { cleanups.splice(0).forEach((off) => off()); });

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

beforeEach(() => {
  vi.useRealTimers();
  h.appFetch.mockReset();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "keychain_get") {
      if (args?.key === "server_url") return "https://sync.example.com";
      if (args?.key === "jwt") return jwt();
      if (args?.key === "account_id") return "account-1";
      return null;
    }
    if (cmd === "backup_export") return [];
    if (cmd === "state_export_raw") return { files: {}, secrets: {}, secret_clocks: {} };
    return null;
  });
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  localStorage.setItem("voltius.device_id", "local-device");
  setVaultKey([1, 2, 3]);
  resumeSync();
  useSubscriptionStore.setState({ isPro: false });
});

test("scheduleSync notifies local-mutation listeners even without Pro", () => {
  const fn = vi.fn();
  track(onLocalMutation(fn));
  scheduleSync();
  expect(fn).toHaveBeenCalledTimes(1);
});

test("unsubscribe stops notifications", () => {
  const fn = vi.fn();
  onLocalMutation(fn)();
  scheduleSync();
  expect(fn).not.toHaveBeenCalled();
});

test("a throwing listener does not stop others", () => {
  const fn = vi.fn();
  track(onLocalMutation(() => { throw new Error("boom"); }));
  track(onLocalMutation(fn));
  expect(() => scheduleSync()).not.toThrow();
  expect(fn).toHaveBeenCalledTimes(1);
});

test("push keeps the device name and platform out of server-visible metadata", async () => {
  await push();
  const upload = h.appFetch.mock.calls.find(([, init]) => init?.method === "PUT");
  const { metadata } = JSON.parse(upload?.[1].body);
  expect(Object.keys(metadata).sort()).toEqual(["device_id", "synced_at"]);
  expect(h.invoke.mock.calls.some(([c]) => c === "device_hostname")).toBe(false);
});

test("mergeRemotePayload notifies merge listeners", async () => {
  const fn = vi.fn();
  track(onRemotePayloadMerged(fn));
  const payload = { files: {}, secrets: {}, secret_clocks: {} };
  await mergeRemotePayload("dev-2", payload);
  expect(fn).toHaveBeenCalledWith("dev-2", payload);
});

test("a throwing merge listener does not break mergeRemotePayload", async () => {
  const fn = vi.fn();
  track(onRemotePayloadMerged(() => { throw new Error("boom"); }));
  track(onRemotePayloadMerged(fn));
  await expect(mergeRemotePayload("dev-2", { files: {}, secrets: {}, secret_clocks: {} })).resolves.toBe(false);
  expect(fn).toHaveBeenCalledTimes(1);
});

test("mergeRemotePayload applies remote settings and live sessions", async () => {
  const ingestManifest = vi.spyOn(useCrossDeviceSessionsStore.getState(), "ingestManifest");
  const manifest = { deviceId: "dev-2", sessions: [] };
  const settings = {
    type: "voltius-user-data",
    version: 2,
    exported_at: "2030-01-01T00:00:00.000Z",
    sections: {
      appSettings: { updated_at: "2030-01-01T00:00:00.000Z", data: { terminal: { cursorStyle: "underline" } } },
    },
  };
  await mergeRemotePayload("dev-2", {
    files: { "settings.json": JSON.stringify(settings), "live_sessions.json": JSON.stringify(manifest) },
    secrets: {},
    secret_clocks: {},
  });
  expect(h.invoke.mock.calls.some(([c]) => c === "settings_save")).toBe(true);
  expect(ingestManifest).toHaveBeenCalledWith(manifest);
});
