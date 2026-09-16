import { describe, expect, test } from "vitest";
import { matchPanelShortcut } from "./panelShortcuts";

function key(k: string, mods: Partial<KeyboardEvent> = {}) {
  return new KeyboardEvent("keydown", { key: k, ctrlKey: true, shiftKey: true, ...mods });
}

describe("matchPanelShortcut", () => {
  test.each([
    ["h", "history"],
    ["s", "snippets"],
    ["t", "themes"],
    ["n", "notes"],
  ])("Ctrl+Shift+%s opens %s", (k, section) => {
    expect(matchPanelShortcut(key(k))).toBe(section);
  });

  test("returns null for unrelated chords", () => {
    expect(matchPanelShortcut(key("n", { shiftKey: false }))).toBeNull();
    expect(matchPanelShortcut(key("q"))).toBeNull();
  });
});
