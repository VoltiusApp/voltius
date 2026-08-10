import { describe, test, expect, vi, beforeEach } from "vitest";
import type { TFunction } from "i18next";

vi.mock("@/stores/shortcutStore", () => ({
  getShortcutHint: (id: string) => `hint:${id}`,
}));

import { clipboardMenuItems } from "@/utils/clipboardMenuItems";

const t = ((k: string) => k) as unknown as TFunction;

describe("clipboardMenuItems", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("is cut then copy, with the divider opening the group", () => {
    const items = clipboardMenuItems(t);
    expect(items.map((i) => i.label)).toEqual(["common.action.cut", "common.action.copy"]);
    expect(items.map((i) => i.icon)).toEqual(["lucide:scissors", "lucide:copy"]);
    expect(items.map((i) => i.divider)).toEqual([true, undefined]);
  });

  test("carries the live shortcut hints", () => {
    expect(clipboardMenuItems(t).map((i) => i.shortcut)).toEqual(["hint:cut", "hint:copy"]);
  });

  test("each entry dispatches the window event the page hook listens for", () => {
    const seen: string[] = [];
    const spy = vi.spyOn(window, "dispatchEvent").mockImplementation((e: Event) => {
      seen.push(e.type);
      return true;
    });
    for (const item of clipboardMenuItems(t)) item.onClick?.();
    expect(seen).toEqual(["voltius:clipboard-cut", "voltius:clipboard-copy"]);
    spy.mockRestore();
  });
});
