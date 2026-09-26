import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));

import { syncNow, ENTITY_FILES, getSyncState } from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useLocaleStore } from "@/stores/localeStore";
import { useVaultStore } from "@/stores/vaultStore";
import { setVaultKey } from "@/services/vault";

function jwt(expOffsetSec: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  const exp = Math.floor(Date.now() / 1000) + expOffsetSec;
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`;
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const notFound = { ok: false, status: 404, json: async () => ({}) };
const emptyEntityFiles = () => Object.fromEntries(ENTITY_FILES.map((f) => [f, "[]"]));

/**
 * One remote device ("remote-1") whose blob decrypts to `remoteFiles`, against
 * a local disk holding `localFiles`. Records what the sync round writes.
 */
function serveRemoteDevice(
  remoteFiles: Record<string, string>,
  localFiles: Record<string, string> = {},
  overrides: Record<string, unknown> = {},
) {
  const served = {
    settingsSaves: [] as string[],
    stateImports: [] as Array<{ files: Record<string, string> }>,
  };
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd in overrides) return overrides[cmd];
    switch (cmd) {
      case "keychain_get":
        if (args?.key === "server_url") return "https://sync.example.com";
        if (args?.key === "jwt") return jwt(3600);
        if (args?.key === "account_id") return "account-1";
        return null;
      case "backup_export":
        return [];
      case "backup_decrypt":
        return { files: { ...emptyEntityFiles(), ...remoteFiles }, secrets: {}, secret_clocks: {} };
      case "settings_save":
        served.settingsSaves.push(args?.state as string);
        return undefined;
      case "state_export_raw":
        return { files: { ...emptyEntityFiles(), ...localFiles }, secrets: {}, secret_clocks: {} };
      case "state_import":
        served.stateImports.push(args as { files: Record<string, string> });
        return undefined;
      default:
        // The store reloads after a write list from disk.
        return cmd.endsWith("_list") ? [] : null;
    }
  });

  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/teams")) return notFound;
    if (url.endsWith("/v1/sync/devices")) {
      return okJson({ devices: [{ device_id: "remote-1", metadata: {}, updated_at: "2030-01-01T00:00:00.000Z" }] });
    }
    if (url.includes("/v1/sync/blob?device_id=remote-1")) return okJson({ blob: btoa("x") });
    if (url.endsWith("/v1/sync/blob") && init?.method === "PUT") return okJson({});
    return notFound;
  });
  return served;
}

beforeEach(() => {
  h.invoke.mockReset();
  h.appFetch.mockReset();
  useSubscriptionStore.setState({ isPro: true });
  useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} });
  useTerminalSettingsStore.setState({ preferredShell: "/usr/bin/fish" });
  useAppSettingsTimestampStore.setState({ updatedAt: "2020-01-01T00:00:00.000Z" });
  localStorage.setItem("voltius.device_id", "local-device");
  setVaultKey([1, 2, 3]);
});

test("a synced pull writes the raw merge to settings.json but restores this device's held-back value to the stores", async () => {
  // Device A's push (not simulated here) held preferredShell back and is newer,
  // so the section this device receives carries A's shell.
  const remoteBundle = {
    type: "voltius-user-data",
    version: 2,
    exported_at: "2030-01-01T00:00:00.000Z",
    sections: {
      appSettings: {
        updated_at: "2030-01-01T00:00:00.000Z",
        data: { terminal: { preferredShell: "/bin/zsh" } },
      },
    },
  };

  const served = serveRemoteDevice({ "settings.json": JSON.stringify(remoteBundle) });

  // This device holds preferredShell back — the device-scoped default.
  useSyncPrefsStore.getState().setSettingSync("appSettings.terminal.preferredShell", false);

  await syncNow();

  expect(served.settingsSaves).toHaveLength(1);
  const disk = JSON.parse(served.settingsSaves[0]);
  expect(disk.sections.appSettings.data.terminal.preferredShell).toBe("/bin/zsh");

  expect(useTerminalSettingsStore.getState().preferredShell).toBe("/usr/bin/fish");
});

// settings.json is only rewritten by a push, so during a pull it holds the
// state as of the last push — here, before the local edits below.
const settingsAsOfLastPush = (vaults: Record<string, unknown>) => JSON.stringify({
  type: "voltius-user-data",
  version: 2,
  exported_at: "2020-01-01T00:00:00.000Z",
  sections: {
    appSettings: { updated_at: "2020-01-01T00:00:00.000Z", data: { locale: "en" } },
    vaults: { updated_at: "2020-01-01T00:00:00.000Z", data: vaults },
  },
});

const remoteSettings = (sections: Record<string, unknown>) => ({
  "settings.json": JSON.stringify({ type: "voltius-user-data", version: 2, exported_at: "2030-01-01T00:00:00.000Z", sections }),
});

test("a local settings edit newer than the remote survives a pull made before its push", async () => {
  useLocaleStore.setState({ locale: "fr" });
  useAppSettingsTimestampStore.setState({ updatedAt: "2031-01-01T00:00:00.000Z" });
  serveRemoteDevice(
    remoteSettings({ appSettings: { updated_at: "2030-01-01T00:00:00.000Z", data: { locale: "tr" } } }),
    {},
    { settings_load: settingsAsOfLastPush({}) },
  );

  await syncNow();

  expect(useLocaleStore.getState().locale).toBe("fr");
});

test("a vault created since the last push survives a pull that brings another device's vault", async () => {
  const personal = { name: "Personal", updatedAt: "2020-01-01T00:00:00.000Z" };
  useVaultStore.setState({
    vaults: [
      { id: "personal", name: "Personal", updatedAt: personal.updatedAt },
      { id: "v-new", name: "Just created", updatedAt: "2031-01-01T00:00:00.000Z" },
    ],
    deletedVaults: {},
  });
  serveRemoteDevice(
    remoteSettings({
      vaults: {
        updated_at: "2030-01-01T00:00:00.000Z",
        data: { personal, "v-remote": { name: "From elsewhere", updatedAt: "2030-01-01T00:00:00.000Z" } },
      },
    }),
    {},
    { settings_load: settingsAsOfLastPush({ personal }) },
  );

  await syncNow();

  expect(useVaultStore.getState().vaults.map((v) => v.id).sort()).toEqual(["personal", "v-new", "v-remote"]);
});

test("the status reports success as soon as the work ends, while calls during the hold are still dropped", async () => {
  h.invoke.mockImplementation(async (cmd: string, args?: { key?: string }) => {
    if (cmd !== "keychain_get") return null;
    if (args?.key === "server_url") return "https://sync.example.com";
    return args?.key === "jwt" ? jwt(3600) : null;
  });
  let deviceListings = 0;
  h.appFetch.mockImplementation(async (url: string) => {
    if (!url.endsWith("/v1/sync/devices")) return notFound;
    deviceListings++;
    return okJson({ devices: [] });
  });

  const first = syncNow();
  await vi.waitFor(() => expect(getSyncState().status).toBe("success"), { timeout: 300 });
  await syncNow();
  await first;
  expect(deviceListings).toBe(1);

  await syncNow();
  expect(deviceListings).toBe(2);
});

test("a remote rename older than a local last-used touch is still written to disk", async () => {
  // The remote device renamed the host at 10:00; this one opened it at 10:01.
  // The merged host's newest clock is still the local 10:01.
  const local = {
    id: "c1", name: "orig", last_used_at: "2030-01-01T10:01:00.000Z", updated_at: "2030-01-01T10:01:00.000Z",
    clocks: { name: "2030-01-01T09:00:00.000Z", last_used_at: "2030-01-01T10:01:00.000Z" },
  };
  const remote = {
    id: "c1", name: "renamed", last_used_at: null, updated_at: "2030-01-01T10:00:00.000Z",
    clocks: { name: "2030-01-01T10:00:00.000Z" },
  };
  const served = serveRemoteDevice(
    { "connections.json": JSON.stringify([remote]) },
    { "connections.json": JSON.stringify([local]) },
  );

  await syncNow();

  expect(served.stateImports).toHaveLength(1);
  const [written] = JSON.parse(served.stateImports[0].files["connections.json"]);
  expect(written.name).toBe("renamed");
  expect(written.last_used_at).toBe(local.last_used_at);
});
