// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { PermissionGrid } from "./RolesPanel";

afterEach(cleanup);

const rowClasses = (size?: "sm" | "touch") => {
  const { container } = render(<PermissionGrid value={0} size={size} />);
  return [...container.querySelectorAll("label")].map((l) => l.className);
};

test("touch_size_rows_are_at_least_48px", () => {
  const rows = rowClasses("touch");
  expect(rows.length).toBeGreaterThan(0);
  rows.forEach((c) => expect(c).toContain("min-h-12"));
});

test("default_rows_keep_the_desktop_classes", () => {
  rowClasses().forEach((c) => expect(c).not.toContain("min-h-12"));
});
