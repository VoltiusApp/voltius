import { test, expect, vi } from "vitest";
import type { TFunction } from "i18next";

vi.mock("@/stores/shortcutStore", () => ({ getShortcutHint: () => "" }));

import { buildConnectionMenuItems } from "./connectionMenuItems";

const base = {
  t: ((k: string) => k) as unknown as TFunction,
  contributions: [],
  isSynced: true,
  pingDisabled: false,
  onToggleSync: () => {},
  onTogglePing: () => {},
};

test("Connect is offered only when the caller may connect", () => {
  const labels = (items: { label: string }[]) => items.map((i) => i.label);
  expect(labels(buildConnectionMenuItems({ ...base, onConnect: () => {} }))).toContain("common.action.connect");
  expect(labels(buildConnectionMenuItems(base))).not.toContain("common.action.connect");
});
