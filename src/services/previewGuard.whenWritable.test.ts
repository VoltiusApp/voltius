import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/services/appToast", () => ({ appToast: toast }));

import { bindPreviewGuard, whenWritable } from "./previewGuard";

let previewing = false;
beforeEach(() => {
  toast.mockReset();
  previewing = false;
  bindPreviewGuard({ active: () => previewing, showWhy: vi.fn() });
});

test("whenWritable runs the handler with its arguments and result outside a preview", () => {
  const run = vi.fn((a: number, b: number) => a + b);
  expect(whenWritable(run)(1, 2)).toBe(3);
  expect(run).toHaveBeenCalledWith(1, 2);
});

test("whenWritable refuses with one toast and skips the handler while previewing", async () => {
  previewing = true;
  const run = vi.fn(() => "ran");
  expect(whenWritable(run)()).toBeUndefined();
  expect(run).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(toast).toHaveBeenCalledWith("info", "members.viewAs.readOnly");
});
