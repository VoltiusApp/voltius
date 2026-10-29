// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));

import { push, scheduleSync, resumeSync, onLocalMutation, onRemotePayloadMerged, mergeRemotePayload } from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { setVaultKey } from "@/services/vault";

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
    if (cmd === "device_hostname") return "ThinkPad";
    if (cmd === "get_platform") return "linux";
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
  const off = onLocalMutation(fn);
  scheduleSync();
  expect(fn).toHaveBeenCalledTimes(1);
  off();
});

test("unsubscribe stops notifications", () => {
  const fn = vi.fn();
  onLocalMutation(fn)();
  scheduleSync();
  expect(fn).not.toHaveBeenCalled();
});

test("a throwing listener does not stop others", () => {
  const fn = vi.fn();
  const offs = [onLocalMutation(() => { throw new Error("boom"); }), onLocalMutation(fn)];
  expect(() => scheduleSync()).not.toThrow();
  expect(fn).toHaveBeenCalledTimes(1);
  offs.forEach((off) => off());
});

test("push sends device_name and platform in metadata", async () => {
  await push();
  const upload = h.appFetch.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(JSON.parse(upload?.[1].body).metadata).toMatchObject({ device_name: "ThinkPad", platform: "linux" });
});

test("mergeRemotePayload notifies merge listeners", async () => {
  const fn = vi.fn();
  const off = onRemotePayloadMerged(fn);
  const payload = { files: {}, secrets: {}, secret_clocks: {} };
  await mergeRemotePayload("dev-2", payload);
  expect(fn).toHaveBeenCalledWith("dev-2", payload);
  off();
});
