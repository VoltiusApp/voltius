// @vitest-environment jsdom
import { beforeEach, describe, expect, it, test } from "vitest";
import { cursorStyleSetting, keywordRulesSetting, migrateTerminalSettings, preferredShellSetting, useTerminalSettingsStore } from "./terminalSettingsStore";
import { resetPolicy, withPolicy } from "@/test/policy";
const CURSOR = "appSettings.terminal.cursorStyle";

describe("terminal settings under policy", () => {
  beforeEach(() => {
    resetPolicy();
    useTerminalSettingsStore.setState({ cursorStyle: "bar", preferredShell: null, keywordRules: [] });
  });

  it("setter is a no-op under a lock", () => {
    withPolicy({ [CURSOR]: "block", "appSettings.terminal.preferredShell": "/bin/zsh" });
    useTerminalSettingsStore.getState().setCursorStyle("underline");
    useTerminalSettingsStore.getState().setPreferredShell("/bin/sh");
    expect(useTerminalSettingsStore.getState().cursorStyle).toBe("bar");
    expect(useTerminalSettingsStore.getState().preferredShell).toBeNull();
    expect(cursorStyleSetting.get()).toBe("block");
  });

  it("an allowed-list range moves a disallowed cursor style to an allowed one", () => {
    useTerminalSettingsStore.setState({ cursorStyle: "underline" });
    withPolicy({ [CURSOR]: { $range: { allowed: ["bar", "block"] } } });
    expect(cursorStyleSetting.get()).toBe("bar");
  });

  it("a stored shell path stays under a name-based allowed list", () => {
    withPolicy({ [preferredShellSetting.key]: { $range: { allowed: ["fish", "zsh"] } } });
    useTerminalSettingsStore.getState().setPreferredShell("/bin/zsh");
    expect(preferredShellSetting.get()).toBe("/bin/zsh");
  });

  it("keyword rules stay editable and follow admin rules", () => {
    const admin = { id: "a", color: "red", words: ["prod"], enabled: true };
    withPolicy({ "appSettings.terminal.keywordRules": [admin] });
    useTerminalSettingsStore.getState().setKeywordRules([{ id: "u", color: "green", words: ["prod"], enabled: true }]);
    expect(keywordRulesSetting.get().map((r) => r.id)).toEqual(["a", "u"]);
  });
});

describe("scrollback default migration", () => {
  test("a saved 50,000 from the old default becomes the new 10,000 default", () => {
    expect(migrateTerminalSettings({ scrollbackLines: 50_000 }, 0)).toMatchObject({ scrollbackLines: 10_000 });
  });

  test("any other saved value is kept", () => {
    for (const lines of [1_000, 100_000, 250_000]) {
      expect(migrateTerminalSettings({ scrollbackLines: lines }, 0)).toMatchObject({ scrollbackLines: lines });
    }
  });

  test("runs once: a 50,000 saved after the migration is kept", () => {
    expect(migrateTerminalSettings({ scrollbackLines: 50_000 }, 1)).toMatchObject({ scrollbackLines: 50_000 });
  });
});
