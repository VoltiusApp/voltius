// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ os: "linux" }));
vi.mock("@/utils/platform", () => ({ getPlatformSync: () => platform.os }));

import { formatShortcut, getDefaultShortcut, matchShortcut, useShortcutStore } from "./shortcutStore";

const press = (key: string, mods: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key, ...mods });

afterEach(() => { platform.os = "linux"; });

describe("app shortcuts on macOS", () => {
  it("bind ⌘ and leave Ctrl chords to the terminal", () => {
    platform.os = "macos";
    useShortcutStore.getState().resetAll();
    for (const id of ["omni", "copy", "paste", "close-tab", "new-tab", "sidebar", "terminal-search", "undo"]) {
      const key = getDefaultShortcut(id)!.defaultKey;
      expect(matchShortcut(id, press(key, { metaKey: true })), `${id} on ⌘`).toBe(true);
      expect(matchShortcut(id, press(key, { ctrlKey: true })), `${id} on Ctrl`).toBe(false);
      expect(matchShortcut(id, press(key, { ctrlKey: true, metaKey: true })), `${id} on Ctrl+⌘`).toBe(false);
    }
  });

  it("keep Ctrl where macOS owns the ⌘ chord", () => {
    platform.os = "macos";
    useShortcutStore.getState().resetAll();
    expect(matchShortcut("next-tab", press("Tab", { ctrlKey: true }))).toBe(true);
    expect(matchShortcut("shortcuts", press(" ", { ctrlKey: true }))).toBe(true);
    expect(matchShortcut("next-tab", press("Tab", { metaKey: true }))).toBe(false);
  });

  it("never fire an unmodified shortcut while Ctrl is held", () => {
    platform.os = "macos";
    useShortcutStore.getState().resetAll();
    expect(matchShortcut("delete", press("Delete"))).toBe(true);
    expect(matchShortcut("delete", press("Delete", { ctrlKey: true }))).toBe(false);
  });

  it("display as Cmd", () => {
    platform.os = "macos";
    expect(formatShortcut({ key: "k", ctrl: true, shift: false, alt: false })).toBe("Cmd+K");
    expect(formatShortcut({ key: "Tab", ctrl: true, shift: false, alt: false })).toBe("Ctrl+Tab");
  });
});

describe("app shortcuts elsewhere", () => {
  it("bind Ctrl only", () => {
    useShortcutStore.getState().resetAll();
    expect(matchShortcut("omni", press("k", { ctrlKey: true }))).toBe(true);
    expect(matchShortcut("omni", press("k", { metaKey: true }))).toBe(false);
    expect(formatShortcut({ key: "k", ctrl: true, shift: false, alt: false })).toBe("Ctrl+K");
  });
});
