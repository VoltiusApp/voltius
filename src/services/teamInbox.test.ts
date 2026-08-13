import { test, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  accept: vi.fn(async () => {}),
  decline: vi.fn(async () => {}),
}));
vi.mock("@/services/invitationActions", () => ({
  acceptInvitation: h.accept,
  declineInvitation: h.decline,
}));
vi.mock("@/i18n", () => ({
  default: { t: (k: string, o?: Record<string, unknown>) => `${k}:${JSON.stringify(o ?? {})}` },
}));

import { useNotificationStore } from "@/stores/notificationStore";
import { reconcileInvites } from "./teamInbox";
import type { MyPendingInvitation } from "@/services/teamService";

const get = () => useNotificationStore.getState();

function invite(id: string): MyPendingInvitation {
  return {
    id,
    team_id: `team-${id}`,
    team_name: "Acme",
    inviter_display_name: "Alice",
    role: "member",
    created_at: "2026-08-13T00:00:00Z",
    expires_at: "2026-08-20T00:00:00Z",
  };
}

beforeEach(() => {
  useNotificationStore.setState({ toasts: [], banners: [], history: [], inbox: [] });
  h.accept.mockClear();
  h.decline.mockClear();
});

test("reconciling the same invite list twice yields one entry", () => {
  reconcileInvites([invite("a")]);
  reconcileInvites([invite("a")]);
  expect(get().inbox).toHaveLength(1);
  expect(get().inbox[0].id).toBe("invite:a");
});

test("an invite that vanishes from the source is retracted", () => {
  reconcileInvites([invite("a"), invite("b")]);
  reconcileInvites([invite("b")]);
  expect(get().inbox.map((e) => e.id)).toEqual(["invite:b"]);
});

test("reconciling does not touch non-invite entries", () => {
  get().upsertInbox({
    id: "session:s1",
    source: { kind: "app", area: "team" },
    kind: "sessionShared",
    message: "m",
    actions: [],
  });
  reconcileInvites([]);
  expect(get().inbox.map((e) => e.id)).toEqual(["session:s1"]);
});

test("Accept runs the extracted accept action with the invitation and team id", async () => {
  reconcileInvites([invite("a")]);
  await get().runInboxAction("invite:a", 0);
  expect(h.accept).toHaveBeenCalledWith("a", "team-a");
});

test("Decline runs the extracted decline action", async () => {
  reconcileInvites([invite("a")]);
  await get().runInboxAction("invite:a", 1);
  expect(h.decline).toHaveBeenCalledWith("a");
});
