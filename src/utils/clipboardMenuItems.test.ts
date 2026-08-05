import { test, expect, vi } from "vitest";
import type { TFunction } from "i18next";

vi.mock("@/stores/shortcutStore", () => ({ getShortcutHint: (id: string) => `HINT:${id}` }));

import { clipboardMenuItems } from "./clipboardMenuItems";
import { buildConnectionMenuItems } from "./connectionMenuItems";

const t = ((k: string) => k) as unknown as TFunction;

test("cut and copy carry their shortcut hints and dispatch the clipboard events", () => {
  const items = clipboardMenuItems(t);
  expect(items.map((i) => [i.label, i.shortcut])).toEqual([
    ["common.action.cut", "HINT:cut"],
    ["common.action.copy", "HINT:copy"],
  ]);

  const seen: string[] = [];
  const listener = (e: Event) => seen.push(e.type);
  for (const name of ["voltius:clipboard-cut", "voltius:clipboard-copy"]) {
    window.addEventListener(name, listener);
  }
  items.forEach((i) => i.onClick?.());
  for (const name of ["voltius:clipboard-cut", "voltius:clipboard-copy"]) {
    window.removeEventListener(name, listener);
  }
  expect(seen).toEqual(["voltius:clipboard-cut", "voltius:clipboard-copy"]);
});

// Right-clicking one host is the common gesture; without this the shortcuts are
// only discoverable by first multi-selecting.
test("the single-item connection menu offers cut and copy", () => {
  const labels = buildConnectionMenuItems({
    t, canEdit: true, contributions: [], isSynced: true, pingDisabled: false,
    onConnect: () => {}, onToggleSync: () => {}, onTogglePing: () => {}, onDelete: () => {},
  }).map((i) => i.label);

  expect(labels).toContain("common.action.cut");
  expect(labels).toContain("common.action.copy");
  expect(labels.indexOf("common.action.cut")).toBeLessThan(labels.indexOf("common.action.delete"));
});
