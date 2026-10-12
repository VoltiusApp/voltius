// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { appSettingsHandler } from "./appSettings";
import { settingKey } from "../settingKeys";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { TOGGLE_DEFS } from "@/stores/toggleDefs";
import { DEFAULT_KEYWORD_RULES, type KeywordRule } from "@/utils/keywordMatcher";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const custom: KeywordRule[] = [{ id: "mine", color: "cyan", words: ["todo"], enabled: true }];

describe("keyword highlight settings", () => {
  beforeEach(() => useTerminalSettingsStore.setState({ keywordRules: DEFAULT_KEYWORD_RULES }));

  test("the switch is a terminal toggle that defaults to on", () => {
    expect(TOGGLE_DEFS["keyword-highlight"]).toMatchObject({ section: "terminal", default: true });
  });

  test("the store starts with the default rules and sanitises what it is given", () => {
    expect(useTerminalSettingsStore.getState().keywordRules).toEqual(DEFAULT_KEYWORD_RULES);
    useTerminalSettingsStore.getState().setKeywordRules([
      { id: "mine", color: "cyan", words: [" TODO ", "todo"], enabled: true },
    ]);
    expect(useTerminalSettingsStore.getState().keywordRules).toEqual(custom);
  });

  test("the rules are a registered sync key", () => {
    expect(settingKey("appSettings.terminal.keywordRules")).toBeDefined();
  });

  test("export carries the rules", () => {
    useTerminalSettingsStore.setState({ keywordRules: custom });
    const data = appSettingsHandler.export() as unknown as { terminal: { keywordRules: KeywordRule[] } };
    expect(data.terminal.keywordRules).toEqual(custom);
  });

  test("import applies the rules", async () => {
    await appSettingsHandler.import({ terminal: { keywordRules: custom } });
    expect(useTerminalSettingsStore.getState().keywordRules).toEqual(custom);
  });

  test("import sanitises rules from a peer", async () => {
    await appSettingsHandler.import({
      terminal: { keywordRules: [{ id: "x", color: "pink", words: ["a"] }, ...custom] },
    });
    expect(useTerminalSettingsStore.getState().keywordRules).toEqual(custom);
  });

  test("an absent or malformed leaf leaves the local rules alone", async () => {
    useTerminalSettingsStore.setState({ keywordRules: custom });
    await appSettingsHandler.import({ terminal: { cursorStyle: "bar" } });
    await appSettingsHandler.import({ terminal: { keywordRules: "error" } });
    expect(useTerminalSettingsStore.getState().keywordRules).toEqual(custom);
  });
});
