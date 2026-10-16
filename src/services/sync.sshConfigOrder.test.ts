// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamDataManager", () => ({ onTeamLogin: vi.fn(async () => {}) }));

import { syncNow, syncOnLoginReplace, ENTITY_FILES } from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { setVaultKey } from "@/services/vault";

function jwt(expOffsetSec: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + expOffsetSec })}.sig`;
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const notFound = { ok: false, status: 404, json: async () => ({}) };
const remoteFiles = () => ({
  ...Object.fromEntries(ENTITY_FILES.map((f) => [f, "[]"])),
  "connections.json": JSON.stringify([{ id: "c1", name: "web", updated_at: "2026-02-01T00:00:00.000Z", clocks: {} }]),
  "ssh-config.json": JSON.stringify({ managed: { c1: { alias: "web", at: 1, devices: {} } } }),
});

function serve(): string[] {
  const calls: string[] = [];
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push(cmd);
    switch (cmd) {
      case "keychain_get":
        if (args?.key === "server_url") return "https://sync.example.com";
        if (args?.key === "jwt") return jwt(3600);
        if (args?.key === "account_id") return "account-1";
        return null;
      case "state_export_raw":
        return { files: Object.fromEntries(ENTITY_FILES.map((f) => [f, "[]"])), secrets: {}, secret_clocks: {} };
      case "backup_decrypt":
        return { files: remoteFiles(), secrets: {}, secret_clocks: {} };
      case "backup_export":
        return [];
      default:
        return cmd.endsWith("_list") ? [] : null;
    }
  });
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/sync/devices")) {
      return okJson({ devices: [{ device_id: "remote-1", metadata: {}, updated_at: "2030-01-01T00:00:00.000Z" }] });
    }
    if (url.includes("/v1/sync/blob?device_id=remote-1")) return okJson({ blob: btoa("x") });
    if (url.endsWith("/v1/sync/blob") && init?.method === "PUT") return okJson({});
    return notFound;
  });
  return calls;
}

const appliedAfterImport = (calls: string[]) => {
  const imported = calls.indexOf("state_import");
  expect(imported).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("ssh_config_state_save")).toBeGreaterThan(imported);
};

beforeEach(() => {
  h.invoke.mockReset();
  h.appFetch.mockReset();
  useSubscriptionStore.setState({ isPro: true });
  useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], syncSettingDomains: {}, settingSyncOverrides: {} });
  localStorage.setItem("voltius.device_id", "local-device");
  setVaultKey([1, 2, 3]);
});

test("a pull applies the remote ~/.ssh/config state after importing the hosts it names", async () => {
  const calls = serve();
  await syncNow();
  appliedAfterImport(calls);
});

test("a replacing login applies the remote ~/.ssh/config state after importing the hosts it names", async () => {
  const calls = serve();
  await syncOnLoginReplace();
  appliedAfterImport(calls);
});
