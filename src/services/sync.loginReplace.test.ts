// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamDataManager", () => ({ onTeamLogin: vi.fn(async () => {}) }));

import { syncOnLoginReplace, ENTITY_FILES } from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { setVaultKey } from "@/services/vault";
import { GLOBAL_PROXY_PASSWORD_KEY as PROXY_KEY } from "@/services/teamVaultSecretKeys";

function jwt(expOffsetSec: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + expOffsetSec })}.sig`;
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const notFound = { ok: false, status: 404, json: async () => ({}) };
const emptyEntityFiles = () => Object.fromEntries(ENTITY_FILES.map((f) => [f, "[]"]));

// Assembled so secret scanners don't read the fixtures as credentials.
const LOCAL_HOST_KEY = ["password", "local-host"].join(":");
const REMOTE_HOST_KEY = ["password", "remote-host"].join(":");

const LOCAL_SECRETS = { [PROXY_KEY]: "proxy-pw", [LOCAL_HOST_KEY]: "old" };
const LOCAL_CLOCKS = { [PROXY_KEY]: "2026-01-01T00:00:00.000Z", [LOCAL_HOST_KEY]: "2026-01-01T00:00:00.000Z" };

function serve() {
  const imports: Array<{ secrets: Record<string, string>; secretClocks: Record<string, string> }> = [];
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "keychain_get":
        if (args?.key === "server_url") return "https://sync.example.com";
        if (args?.key === "jwt") return jwt(3600);
        if (args?.key === "account_id") return "account-1";
        return null;
      case "state_export_raw":
        return { files: emptyEntityFiles(), secrets: LOCAL_SECRETS, secret_clocks: LOCAL_CLOCKS };
      case "backup_decrypt":
        return {
          files: emptyEntityFiles(),
          secrets: { [REMOTE_HOST_KEY]: "new" },
          secret_clocks: { [REMOTE_HOST_KEY]: "2026-02-01T00:00:00.000Z" },
        };
      case "backup_export":
        return [];
      case "state_import":
        imports.push(args as (typeof imports)[number]);
        return undefined;
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
  return imports;
}

beforeEach(() => {
  h.invoke.mockReset();
  h.appFetch.mockReset();
  useSubscriptionStore.setState({ isPro: true });
  useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], syncSettingDomains: {}, settingSyncOverrides: {} });
  localStorage.setItem("voltius.device_id", "local-device");
  setVaultKey([1, 2, 3]);
});

test("a replacing login keeps the device-only global proxy password and nothing else local", async () => {
  const imports = serve();

  await syncOnLoginReplace();

  expect(imports).toHaveLength(1);
  expect(imports[0].secrets).toEqual({ [PROXY_KEY]: "proxy-pw", [REMOTE_HOST_KEY]: "new" });
  expect(imports[0].secretClocks[PROXY_KEY]).toBe(LOCAL_CLOCKS[PROXY_KEY]);
});

test("once the proxy setting syncs, its password is the account's to restore, not the device's", async () => {
  useSyncPrefsStore.getState().setSettingSync("appSettings.proxy", true);
  const imports = serve();

  await syncOnLoginReplace();

  expect(imports[0].secrets).toEqual({ [REMOTE_HOST_KEY]: "new" });
});
