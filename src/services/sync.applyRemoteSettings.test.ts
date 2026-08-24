import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));

import { syncNow, ENTITY_FILES } from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { setVaultKey } from "@/services/vault";

function jwt(expOffsetSec: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  const exp = Math.floor(Date.now() / 1000) + expOffsetSec;
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`;
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const notFound = { ok: false, status: 404, json: async () => ({}) };
const emptyEntityFiles = () => Object.fromEntries(ENTITY_FILES.map((f) => [f, "[]"]));

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

  let savedState: string | null = null;

  h.invoke.mockImplementation(async (cmd: string, args?: { key?: string; state?: string }) => {
    switch (cmd) {
      case "keychain_get":
        if (args?.key === "server_url") return "https://sync.example.com";
        if (args?.key === "jwt") return jwt(3600);
        return null;
      case "secrets_unlock":
        return undefined;
      case "backup_decrypt":
        return {
          files: { "settings.json": JSON.stringify(remoteBundle), ...emptyEntityFiles() },
          secrets: {},
          secret_clocks: {},
        };
      case "settings_load":
        return null;
      case "settings_save":
        savedState = args?.state ?? null;
        return undefined;
      case "state_export_raw":
        return { files: emptyEntityFiles(), secrets: {}, secret_clocks: {} };
      default:
        return null;
    }
  });

  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/v1/teams")) return notFound;
    if (url.endsWith("/v1/sync/devices")) {
      return okJson({ devices: [{ device_id: "remote-1", metadata: {}, updated_at: "2030-01-01T00:00:00.000Z" }] });
    }
    if (url.includes("/v1/sync/blob?device_id=remote-1")) return okJson({ blob: btoa("x") });
    return notFound;
  });

  // This device holds preferredShell back — the device-scoped default.
  useSyncPrefsStore.getState().setSettingSync("appSettings.terminal.preferredShell", false);

  await syncNow();

  expect(savedState).not.toBeNull();
  const disk = JSON.parse(savedState as unknown as string);
  expect(disk.sections.appSettings.data.terminal.preferredShell).toBe("/bin/zsh");

  expect(useTerminalSettingsStore.getState().preferredShell).toBe("/usr/bin/fish");
});
