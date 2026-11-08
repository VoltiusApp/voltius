import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ addToast: vi.fn(() => "toast-1"), updateToast: vi.fn() }));

vi.mock("@/stores/notificationStore", () => ({
  APP_SOURCE: "app",
  useNotificationStore: { getState: () => ({ addToast: h.addToast, updateToast: h.updateToast }) },
}));

import { runTeamAction } from "./teamActionFeedback";

beforeEach(() => {
  h.addToast.mockClear();
  h.updateToast.mockClear();
});

test("a warning for the result replaces the success toast", async () => {
  const result = await runTeamAction({
    pending: "p",
    success: "ok",
    warning: (r: { sent: boolean }) => (r.sent ? null : "not sent"),
    run: async () => ({ sent: false }),
  });

  expect(result).toEqual({ sent: false });
  expect(h.updateToast).toHaveBeenCalledWith(
    "toast-1",
    expect.objectContaining({ message: "not sent", severity: "warning", finishedSeverity: "warning" }),
  );
});

test("no warning for the result keeps the success toast", async () => {
  await runTeamAction({
    pending: "p",
    success: "ok",
    warning: () => null,
    run: async () => ({ sent: true }),
  });

  expect(h.updateToast).toHaveBeenCalledWith(
    "toast-1",
    expect.objectContaining({ message: "ok", severity: "success", finishedSeverity: "success" }),
  );
});
