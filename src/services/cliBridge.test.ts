// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn(), applyPluginChange: vi.fn(), mirrorPlugins: vi.fn(), pluginInstallPolicyIdle: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/saveFile", () => ({ notify: mocks.notify }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "9.9.9" }));
vi.mock("./cliPlugins", () => ({
  applyPluginChange: mocks.applyPluginChange,
  mirrorPlugins: mocks.mirrorPlugins,
  pluginInstallPolicyIdle: mocks.pluginInstallPolicyIdle,
}));

import goldenPending from "../../src-tauri/src/cli_state/fixtures/pending.golden.json?raw";
import { applyCliPending, applySetting, markCliReady, writeCliMirror } from "./cliBridge";
import { readSetting, settingPatch } from "./user-data/settingAccess";
import { LOCKED, usePolicyStore } from "@/stores/policyStore";
import { DEFAULT_CURSOR_STYLE, useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { SETTING_KEYS } from "@/services/user-data/settingKeys";
import { storedServerUrl } from "@/utils/serverInstance";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useAdminDefaultsStore } from "@/stores/adminDefaultsStore";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { TOGGLE_DEFS } from "@/stores/toggleDefs";

const NONE = { policy: {}, defaults: {} };
const entry = (over: Record<string, unknown>) => ({ id: "e1", at: "2026-11-05T00:00:00Z", error: null, ...over });

function pending(...changes: unknown[]) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "cli_pending_load") return { version: 1, changes };
    return null;
  });
}

const calls = (cmd: string) => mocks.invoke.mock.calls.filter((c) => c[0] === cmd);

const settled = () => calls("cli_pending_settle")[0][1];
const PROXY = "appSettings.proxy";

describe("cliBridge before the app is ready", () => {
  it("does_nothing_before_the_app_is_ready", async () => {
    vi.resetModules();
    const fresh = await import("./cliBridge");
    pending(entry({ kind: "server", url: "https://voltius.example.com" }));
    await fresh.applyCliPending();
    await fresh.writeCliMirror();
    expect(mocks.invoke).not.toHaveBeenCalled();
    fresh.markCliReady();
    await fresh.applyCliPending();
    expect(calls("cli_pending_load")).toHaveLength(1);
    mocks.invoke.mockReset();
  });
});

describe("cliBridge", () => {
  beforeAll(() => markCliReady());

  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.notify.mockReset();
    mocks.applyPluginChange.mockReset();
    mocks.mirrorPlugins.mockReset().mockResolvedValue([]);
    mocks.pluginInstallPolicyIdle.mockReset().mockResolvedValue(undefined);
    usePolicyStore.setState({ machine: NONE, server: NONE });
    useTerminalSettingsStore.getState().setCursorStyle("block");
    useAppSettingsTimestampStore.setState({ clocks: {} });
    useToggleSettingsStore.setState({ values: {} });
    useSyncPrefsStore.setState({ settingSyncOverrides: {} });
    useAdminDefaultsStore.setState({ applied: {}, touched: {} });
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

  it("invalid_value_is_dropped_with_one_toast", async () => {
    pending(entry({ kind: "setting", key: "appSettings.terminal.cursorStyle", value: "nope" }));
    await applyCliPending();
    expect(useTerminalSettingsStore.getState().cursorStyle).toBe("block");
    expect(settled()).toEqual({ results: [{ id: "e1", error: null }] });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("unknown_setting_is_dropped_with_one_toast", async () => {
    pending(entry({ kind: "setting", key: "nowhere.thing", value: 1 }));
    await applyCliPending();
    expect(settled()).toEqual({ results: [{ id: "e1", error: null }] });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("normalised_values_count_as_applied", async () => {
    pending(
      entry({ kind: "setting", key: PROXY, value: { mode: "http", host: " proxy.example ", port: 8080 } }),
      entry({
        id: "e2",
        kind: "setting",
        key: "appSettings.terminal.keywordRules",
        value: [{ id: "r1", color: "red", words: ["ERROR"], extra: 1 }],
      }),
    );
    await applyCliPending();
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "http", host: "proxy.example", port: 8080 });
    expect(useTerminalSettingsStore.getState().keywordRules).toEqual([{ id: "r1", color: "red", words: ["error"], enabled: true }]);
    expect(settled()).toEqual({ results: [{ id: "e1", error: null }, { id: "e2", error: null }] });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("cli_edit_of_proxy_stamps_clock_and_clears_admin_mark", async () => {
    useSyncPrefsStore.setState({ settingSyncOverrides: { [PROXY]: true } });
    useAdminDefaultsStore.setState({ applied: { [PROXY]: true }, touched: {} });
    pending(entry({ kind: "setting", key: PROXY, value: { mode: "socks5", host: "s.example", port: 1080 } }));
    await applyCliPending();
    expect(useAppSettingsTimestampStore.getState().clocks.proxy).toBeTruthy();
    expect(useAdminDefaultsStore.getState().applied[PROXY]).toBeUndefined();
  });

  it("unparsable_server_url_is_dropped", async () => {
    pending(entry({ kind: "server", url: "not a url" }));
    await applyCliPending();
    expect(storedServerUrl()).toBe("");
    expect(settled()).toEqual({ results: [{ id: "e1", error: null }] });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("applies_the_golden_pending_file_written_by_rust", async () => {
    const golden = JSON.parse(goldenPending);
    mocks.applyPluginChange.mockResolvedValue(null);
    pending(...golden.changes);
    await applyCliPending();
    expect(useTerminalSettingsStore.getState().cursorStyle).toBe("bar");
    expect(storedServerUrl()).toBe("https://voltius.example.com");
    expect(mocks.applyPluginChange).toHaveBeenCalledWith({
      action: "install",
      id: "plugin-docker",
      consentedPermissions: ["docker:manage", "storage"],
    });
    expect(settled()).toEqual({
      results: golden.changes.map((c: { id: string }) => ({ id: c.id, error: null })),
    });
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

  it("plugin_entries_wait_for_the_install_policy", async () => {
    let finishPolicy = () => {};
    mocks.pluginInstallPolicyIdle.mockReturnValue(new Promise<void>((r) => (finishPolicy = r)));
    mocks.applyPluginChange.mockResolvedValue(null);
    pending(entry({ kind: "plugin", action: "remove", pluginId: "plugin-x", consentedPermissions: [] }));
    const done = applyCliPending();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.applyPluginChange).not.toHaveBeenCalled();
    finishPolicy();
    await done;
    expect(mocks.applyPluginChange).toHaveBeenCalledTimes(1);
  });

  it("plugin_entries_are_applied_and_settled", async () => {
    mocks.applyPluginChange.mockResolvedValueOnce(null).mockResolvedValueOnce("HTTP 404");
    pending(
      entry({ kind: "plugin", action: "install", pluginId: "plugin-docker", consentedPermissions: ["docker:manage"] }),
      entry({ id: "e2", kind: "plugin", action: "remove", pluginId: "plugin-x" }),
    );
    await applyCliPending();
    expect(mocks.applyPluginChange.mock.calls).toEqual([
      [{ action: "install", id: "plugin-docker", consentedPermissions: ["docker:manage"] }],
      [{ action: "remove", id: "plugin-x", consentedPermissions: [] }],
    ]);
    expect(calls("cli_pending_settle")[0][1]).toEqual({
      results: [{ id: "e1", error: null }, { id: "e2", error: "HTTP 404" }],
    });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
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

  it("mirror_writes_effective_toggles_and_built_ins", async () => {
    mocks.invoke.mockResolvedValue(null);
    useToggleSettingsStore.setState({ values: { "cursor-blink": !TOGGLE_DEFS["cursor-blink"].default } });
    await writeCliMirror();
    const { mirror } = calls("cli_mirror_save")[0][1];
    const review = "appSettings.toggles.plugin-install-review";
    expect(mirror.settings[review]).toBe(TOGGLE_DEFS["plugin-install-review"].default);
    expect(mirror.builtIns[review]).toBe(TOGGLE_DEFS["plugin-install-review"].default);
    expect(mirror.settings["appSettings.toggles.cursor-blink"]).toBe(!TOGGLE_DEFS["cursor-blink"].default);
    expect(mirror.builtIns["appSettings.toggles.cursor-blink"]).toBe(TOGGLE_DEFS["cursor-blink"].default);
    expect(mirror.builtIns["appSettings.terminal.cursorStyle"]).toBe(DEFAULT_CURSOR_STYLE);
    expect(Object.keys(mirror.builtIns).sort()).toEqual(SETTING_KEYS.map((k) => k.id).sort());
    const toggles = Object.keys(mirror.settings).filter((k) => k.startsWith("appSettings.toggles."));
    expect(toggles.filter((k) => mirror.settings[k] === null)).toEqual([]);
  });

  it("mirror_lists_loaded_plugins", async () => {
    const plugin = { id: "plugin-docker", version: "1.2.0", enabled: true, origin: "seeded", locked: null };
    mocks.mirrorPlugins.mockResolvedValue([plugin]);
    mocks.invoke.mockResolvedValue(null);
    await writeCliMirror();
    expect(calls("cli_mirror_save")[0][1].mirror.plugins).toEqual([plugin]);
  });

  it("cli bridge accepts an out-of-range value", async () => {
    usePolicyStore.setState({ machine: { policy: { "appSettings.detachedTtlHours": { $range: { max: 24 } } }, defaults: {} }, server: NONE });
    expect(await applySetting("appSettings.detachedTtlHours", 72)).toBeNull();
    expect(readSetting("appSettings.detachedTtlHours")).toBe(72);
  });

  it("cli bridge refuses an implied toggle", async () => {
    usePolicyStore.setState({ machine: { policy: { "appSettings.detachedTtlHours": { $range: { max: 24 } } }, defaults: {} }, server: NONE });
    expect(await applySetting("appSettings.toggles.detached-session-ttl", false)).toBe(LOCKED);
  });
});
