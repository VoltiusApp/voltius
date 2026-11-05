// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/saveFile", () => ({ notify: mocks.notify }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "9.9.9" }));

import { applyCliPending, writeCliMirror } from "./cliBridge";
import { settingPatch } from "./user-data/settingAccess";
import { usePolicyStore } from "@/stores/policyStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { SETTING_KEYS } from "@/services/user-data/settingKeys";
import { storedServerUrl } from "@/utils/serverInstance";

const NONE = { policy: {}, defaults: {} };
const entry = (over: Record<string, unknown>) => ({ id: "e1", at: "2026-11-05T00:00:00Z", error: null, ...over });

function pending(...changes: unknown[]) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "cli_pending_load") return { version: 1, changes };
    return null;
  });
}

const calls = (cmd: string) => mocks.invoke.mock.calls.filter((c) => c[0] === cmd);

describe("cliBridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.notify.mockReset();
    usePolicyStore.setState({ machine: NONE, server: NONE });
    useTerminalSettingsStore.getState().setCursorStyle("block");
    useAppSettingsTimestampStore.setState({ clocks: {} });
    useToggleSettingsStore.setState({ values: {} });
    localStorage.clear();
  });

  it("settingPatch nests the value under the relative path", () => {
    expect(settingPatch("appSettings.terminal.cursorStyle", "bar")).toEqual({
      domain: "appSettings",
      data: { terminal: { cursorStyle: "bar" } },
    });
  });

  it("applies_setting_and_stamps_clock", async () => {
    pending(entry({ kind: "setting", key: "appSettings.terminal.cursorStyle", value: "bar" }));
    await applyCliPending();
    expect(useTerminalSettingsStore.getState().cursorStyle).toBe("bar");
    expect(useAppSettingsTimestampStore.getState().clocks["terminal.cursorStyle"]).toBeTruthy();
    expect(calls("cli_pending_settle")[0][1]).toEqual({ results: [{ id: "e1", error: null }] });
  });

  it("locked_setting_is_refused", async () => {
    usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.cursor-blink": false }, defaults: {} }, server: NONE });
    pending(entry({ kind: "setting", key: "appSettings.toggles.cursor-blink", value: true }));
    await applyCliPending();
    expect(useToggleSettingsStore.getState().values["cursor-blink"]).toBeUndefined();
    expect(calls("cli_pending_settle")[0][1]).toEqual({ results: [{ id: "e1", error: "locked by policy" }] });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("repeated_failure_toasts_once", async () => {
    usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.cursor-blink": false }, defaults: {} }, server: NONE });
    const e = { kind: "setting", key: "appSettings.toggles.cursor-blink", value: true };
    pending(entry(e));
    await applyCliPending();
    pending(entry({ ...e, error: "locked by policy" }));
    await applyCliPending();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("changed_error_toasts_again", async () => {
    usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.cursor-blink": false }, defaults: {} }, server: NONE });
    pending(entry({ kind: "setting", key: "appSettings.toggles.cursor-blink", value: true, error: "invalid value" }));
    await applyCliPending();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("invalid_value_is_rejected", async () => {
    pending(entry({ kind: "setting", key: "appSettings.terminal.cursorStyle", value: "nope" }));
    await applyCliPending();
    expect(useTerminalSettingsStore.getState().cursorStyle).toBe("block");
    expect(calls("cli_pending_settle")[0][1]).toEqual({ results: [{ id: "e1", error: "invalid value" }] });
  });

  it("server_change_remembers_url", async () => {
    pending(entry({ kind: "server", url: "https://voltius.example.com" }));
    await applyCliPending();
    expect(storedServerUrl()).toBe("https://voltius.example.com");
    expect(calls("cli_pending_settle")[0][1]).toEqual({ results: [{ id: "e1", error: null }] });
  });

  it("locked_server_is_refused", async () => {
    usePolicyStore.setState({ machine: { policy: { "server.url": "https://corp.example.com" }, defaults: {} }, server: NONE });
    pending(entry({ kind: "server", url: "https://voltius.example.com" }));
    await applyCliPending();
    expect(storedServerUrl()).toBe("");
    expect(calls("cli_pending_settle")[0][1]).toEqual({ results: [{ id: "e1", error: "locked by policy" }] });
  });

  it("plugin_entries_are_left_pending", async () => {
    pending(entry({ kind: "plugin", action: "install", pluginId: "plugin-docker", consentedPermissions: [] }));
    await applyCliPending();
    expect(calls("cli_pending_settle")).toHaveLength(0);
  });

  it("corrupt_pending_does_not_throw", async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cli_pending_load") throw new Error("corrupt");
      return null;
    });
    await expect(applyCliPending()).resolves.toBeUndefined();
    expect(calls("cli_pending_settle")).toHaveLength(0);
  });

  it("concurrent_calls_apply_once", async () => {
    pending(entry({ kind: "server", url: "https://voltius.example.com" }));
    await Promise.all([applyCliPending(), applyCliPending()]);
    expect(calls("cli_pending_load")).toHaveLength(1);
    expect(calls("cli_pending_settle")).toHaveLength(1);
  });

  it("mirror_contains_every_setting_key", async () => {
    mocks.invoke.mockResolvedValue(null);
    await writeCliMirror();
    const [, { mirror }] = calls("cli_mirror_save")[0];
    expect(Object.keys(mirror.settings).sort()).toEqual(SETTING_KEYS.map((k) => k.id).sort());
    expect(mirror).toMatchObject({ appVersion: "9.9.9", serverUrl: null, plugins: [] });
    expect(typeof mirror.writtenAt).toBe("string");
  });
});
