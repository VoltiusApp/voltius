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
import { reconcileInvites, reconcileSessions } from "./teamInbox";
import type { MyPendingInvitation } from "@/services/teamService";
import type { ActiveSession } from "@/services/multiplayerService";

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

function session(id: string): ActiveSession {
  return {
    id,
    connection_name: "web-prod",
    host_user_id: "host1",
    host_public_key: "pk",
    visibility: "team",
    created_at: "2026-08-13T00:00:00Z",
    participant_count: 1,
  };
}

test("a shared session becomes one entry, idempotently", () => {
  reconcileSessions([session("s1")], new Set());
  reconcileSessions([session("s1")], new Set());
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(1);
});

test("an ended session is retracted", () => {
  reconcileSessions([session("s1")], new Set());
  reconcileSessions([], new Set());
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(0);
});

test("a session already joined is shown as resolved rather than offering Join again", () => {
  reconcileSessions([session("s1")], new Set(["s1"]));
  const entry = get().inbox.find((e) => e.id === "session:s1")!;
  expect(entry.state).toBe("resolved");
});
