import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/services/appToast", () => ({ appToast: toast }));

import { bindPreviewGuard, whenWritable, whenWritableOn } from "./previewGuard";

let previewing = false;
const showWhy = vi.fn();
beforeEach(() => {
  toast.mockReset();
  showWhy.mockReset();
  previewing = false;
  bindPreviewGuard({ active: () => previewing, showWhy });
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

test("whenWritableOn opens Why for its target and skips the handler while previewing", () => {
  const run = vi.fn();
  whenWritableOn({ type: "key", objectId: "k1" }, run)();
  expect(run).toHaveBeenCalledTimes(1);
  previewing = true;
  whenWritableOn({ type: "key", objectId: "k1" }, run)();
  expect(run).toHaveBeenCalledTimes(1);
  expect(showWhy).toHaveBeenCalledWith("key", "k1");
});
