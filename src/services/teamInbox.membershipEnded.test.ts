import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ setActiveNav: vi.fn() }));

vi.mock("@/i18n", () => ({
  default: { t: (k: string, o?: Record<string, unknown>) => (o?.team ? `${k}:${o.team}` : k) },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ setActiveNav: h.setActiveNav }) },
}));

import { notifyMembershipEnded } from "./teamInbox";
import { useNotificationStore } from "@/stores/notificationStore";

beforeEach(() => {
  h.setActiveNav.mockReset();
  useNotificationStore.setState({ inbox: [], toasts: [] });
});

function entry() {
  return useNotificationStore.getState().inbox.find((e) => e.kind === "membershipEnded");
}

test("raises one actionable inbox entry naming the team", () => {
  notifyMembershipEnded("Platform");

  expect(entry()).toBeDefined();
  expect(entry()!.message).toContain("Platform");
  expect(entry()!.actions).toHaveLength(1);
});

test("its action opens the keychain page", async () => {
  notifyMembershipEnded("Platform");

  await useNotificationStore.getState().runInboxAction(entry()!.id, 0);

  expect(h.setActiveNav).toHaveBeenCalledWith("keychain");
});

test("the toast is marked as an echo so it is not archived beside the entry", () => {
  notifyMembershipEnded("Platform");

  const toasts = useNotificationStore.getState().toasts;
  expect(toasts[toasts.length - 1]?.inboxId).toBe(entry()!.id);
});

test("being removed from two teams raises one entry each", () => {
  notifyMembershipEnded("Platform");
  notifyMembershipEnded("Infra");

  const entries = useNotificationStore.getState().inbox.filter((e) => e.kind === "membershipEnded");
  expect(entries).toHaveLength(2);
});
