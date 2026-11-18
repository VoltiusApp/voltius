// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { usePolicyStore } from "@/stores/policyStore";
import { isAdminDefaulted, useAdminDefaultsStore } from "@/stores/adminDefaultsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useLocaleStore } from "@/stores/localeStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { SETTING_KEYS } from "@/services/user-data/settingKeys";
import { applySettingDefaults, builtIn } from "./adminDefaults";
import { applySetting as applyCliSetting } from "@/services/cliBridge";

const TOGGLE = "cursor-blink" as const;
const TOGGLE_KEY = `appSettings.toggles.${TOGGLE}`;
const NONE = { policy: {}, defaults: {} };
const machine = (policy = {}, defaults = {}) => usePolicyStore.setState({ machine: { policy, defaults } });
const clocks = () => useAppSettingsTimestampStore.getState().clocks;

describe("applySettingDefaults", () => {
  beforeEach(() => {
    usePolicyStore.setState({ machine: NONE, server: NONE });
    useToggleSettingsStore.setState({ values: {} });
    useAdminDefaultsStore.setState({ applied: {}, touched: {} });
    useAppSettingsTimestampStore.setState({ clocks: {} });
    useLocaleStore.setState(useLocaleStore.getInitialState());
    useTerminalSettingsStore.setState(useTerminalSettingsStore.getInitialState());
    useThemeStore.setState({ location: null });
    useConnectivitySettingsStore.setState(useConnectivitySettingsStore.getInitialState());
  });

  it("applies_locale_default_once", () => {
    machine({}, { "appSettings.locale": "fr" });
    applySettingDefaults();
    expect(useLocaleStore.getState().locale).toBe("fr");
    expect(isAdminDefaulted("appSettings.locale")).toBe(true);
    expect(clocks()["locale"]).toBeUndefined();
    useLocaleStore.getState().setLocale("cs");
    applySettingDefaults();
    expect(useLocaleStore.getState().locale).toBe("cs");
  });

  it("a reset to the built-in value is not overridden again", () => {
    const initial = useLocaleStore.getInitialState().locale;
    machine({}, { "appSettings.locale": "fr" });
    applySettingDefaults();
    useLocaleStore.getState().setLocale(initial);
    applySettingDefaults();
    expect(useLocaleStore.getState().locale).toBe(initial);
  });

  it("a cli edit ends default status", async () => {
    machine({}, { "appSettings.proxy": { mode: "system" } });
    applySettingDefaults();
    expect(isAdminDefaulted("appSettings.proxy")).toBe(true);
    await applyCliSetting("appSettings.proxy", { mode: "none" });
    expect(isAdminDefaulted("appSettings.proxy")).toBe(false);
    applySettingDefaults();
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "none" });
  });

  it("every non-toggle setting key has a built-in", () => {
    for (const { id } of SETTING_KEYS) {
      if (!id.startsWith("appSettings.toggles.")) expect(builtIn(id), id).not.toBeUndefined();
    }
  });

  it("user_value_is_not_overwritten", () => {
    useTerminalSettingsStore.getState().setCursorStyle("bar");
    machine({}, { "appSettings.terminal.cursorStyle": "underline" });
    applySettingDefaults();
    expect(useTerminalSettingsStore.getState().cursorStyle).toBe("bar");
    expect(isAdminDefaulted("appSettings.terminal.cursorStyle")).toBe(false);
  });

  it("user_edit_clears_mark", () => {
    machine({}, { "appSettings.terminal.cursorStyle": "underline" });
    applySettingDefaults();
    expect(useTerminalSettingsStore.getState().cursorStyle).toBe("underline");
    expect(isAdminDefaulted("appSettings.terminal.cursorStyle")).toBe(true);
    useTerminalSettingsStore.getState().setCursorStyle("bar");
    expect(isAdminDefaulted("appSettings.terminal.cursorStyle")).toBe(false);
  });

  it("theme_location_default_applies_and_user_edit_clears_mark", () => {
    machine({}, { "themes.location": { lat: 48.8, lon: 2.3 } });
    applySettingDefaults();
    expect(useThemeStore.getState().location).toEqual({ lat: 48.8, lon: 2.3 });
    expect(isAdminDefaulted("themes.location")).toBe(true);
    useThemeStore.getState().setLocation(null);
    expect(isAdminDefaulted("themes.location")).toBe(false);
    applySettingDefaults();
    expect(useThemeStore.getState().location).toBeNull();
  });

  it("locked_key_is_skipped", () => {
    machine({ "appSettings.locale": "fr" }, { "appSettings.locale": "cs" });
    const before = useLocaleStore.getState().locale;
    applySettingDefaults();
    expect(useLocaleStore.getState().locale).toBe(before);
    expect(isAdminDefaulted("appSettings.locale")).toBe(false);
  });

  describe("toggle_defaults_still_apply", () => {
    it("applies once", () => {
      machine({}, { [TOGGLE_KEY]: true });
      applySettingDefaults();
      expect(useToggleSettingsStore.getState().values[TOGGLE]).toBe(true);
      useToggleSettingsStore.getState().set(TOGGLE, false);
      applySettingDefaults();
      expect(useToggleSettingsStore.getState().values[TOGGLE]).toBe(false);
    });

    it("leaves an existing user value untouched", () => {
      useToggleSettingsStore.getState().set(TOGGLE, false);
      machine({}, { [TOGGLE_KEY]: true });
      applySettingDefaults();
      expect(useToggleSettingsStore.getState().values[TOGGLE]).toBe(false);
      expect(isAdminDefaulted(TOGGLE_KEY)).toBe(false);
    });

    it("writes without a sync clock and a user edit clears the mark", () => {
      machine({}, { [TOGGLE_KEY]: true });
      applySettingDefaults();
      expect(clocks()[`toggles.${TOGGLE}`]).toBeUndefined();
      expect(isAdminDefaulted(TOGGLE_KEY)).toBe(true);
      useToggleSettingsStore.getState().set(TOGGLE, false);
      expect(isAdminDefaulted(TOGGLE_KEY)).toBe(false);
    });
  });
});
