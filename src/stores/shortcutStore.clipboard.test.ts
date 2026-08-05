import { test, expect } from "vitest";
import { useShortcutStore, matchShortcut, getDefaultShortcut } from "./shortcutStore";

function keyEvent(key: string, ctrl = true): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ctrlKey: ctrl });
}

test("copy, cut and paste ship as rebindable shortcuts", () => {
  for (const id of ["copy", "cut", "paste"]) {
    const def = getDefaultShortcut(id);
    expect(def, `${id} must exist in DEFAULTS`).toBeDefined();
    expect(def!.labelKey).toBeTruthy();
    expect(def!.descriptionKey).toBeTruthy();
  }
});

test("defaults match Ctrl+C / Ctrl+X / Ctrl+V", () => {
  useShortcutStore.getState().resetAll();
  expect(matchShortcut("copy", keyEvent("c"))).toBe(true);
  expect(matchShortcut("cut", keyEvent("x"))).toBe(true);
  expect(matchShortcut("paste", keyEvent("v"))).toBe(true);
  expect(matchShortcut("paste", keyEvent("v", false))).toBe(false);
});

test("a persisted v5 state gains the new shortcuts on migration", () => {
  const migrated = useShortcutStore.persist.getOptions().migrate!(
    { shortcuts: [{ id: "omni", key: "k", ctrl: true, shift: false, alt: false, defaultKey: "k", labelKey: "x", descriptionKey: "y" }] },
    5,
  ) as { shortcuts: Array<{ id: string }> };
  const ids = migrated.shortcuts.map((s) => s.id);
  expect(ids).toContain("copy");
  expect(ids).toContain("cut");
  expect(ids).toContain("paste");
  expect(ids).toContain("omni");
});
