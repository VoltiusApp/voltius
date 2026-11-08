// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cursorStyleSetting, keywordRulesSetting, useTerminalSettingsStore } from "./terminalSettingsStore";
import { usePolicyStore } from "./policyStore";

const empty = { policy: {}, defaults: {} };
const withPolicy = (policy: Record<string, unknown>) =>
  usePolicyStore.setState({ machine: { policy, defaults: {} }, server: empty });
const CURSOR = "appSettings.terminal.cursorStyle";

describe("terminal settings under policy", () => {
  beforeEach(() => {
    usePolicyStore.setState({ machine: empty, server: empty, issues: [] });
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

  it("keyword rules stay editable and follow admin rules", () => {
    const admin = { id: "a", color: "red", words: ["prod"], enabled: true };
    withPolicy({ "appSettings.terminal.keywordRules": [admin] });
    useTerminalSettingsStore.getState().setKeywordRules([{ id: "u", color: "green", words: ["prod"], enabled: true }]);
    expect(keywordRulesSetting.get().map((r) => r.id)).toEqual(["a", "u"]);
  });
});
