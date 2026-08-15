import { test, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const sessionState = { sessions: [] as Record<string, unknown>[], activeSessionId: null as string | null };
  const useSessionStore = {
    getState: () => sessionState,
    setState: (patch: unknown) =>
      Object.assign(sessionState, typeof patch === "function" ? (patch as (s: typeof sessionState) => unknown)(sessionState) : patch),
  };
  const uiState = { setActiveNav: vi.fn() };
  const useUIStore = { getState: () => uiState };
  const joinSession = vi.fn(async () => "local-99");
  const grantControl = vi.fn();
  const fetchActiveSessions = vi.fn(async () => {});
  const useTeamSessionStore = { getState: () => ({ joinSession, grantControl, fetchActiveSessions }) };
  return {
    accept: vi.fn(async () => {}),
    decline: vi.fn(async () => {}),
    declineSessionInvite: vi.fn(async () => {}),
    getCurrentUserEmail: vi.fn(async () => "me@x" as string | null),
    isMobileShell: vi.fn(() => false),
    sessionState,
    useSessionStore,
    uiState,
    useUIStore,
    joinSession,
    grantControl,
    fetchActiveSessions,
    useTeamSessionStore,
  };
});
vi.mock("@/services/invitationActions", () => ({
  acceptInvitation: h.accept,
  declineInvitation: h.decline,
}));
vi.mock("@/services/teamService", () => ({
  declineSessionInvite: h.declineSessionInvite,
  getMyUserId: vi.fn(async () => "me"),
}));
vi.mock("@/services/account", () => ({ getCurrentUserEmail: () => h.getCurrentUserEmail() }));
vi.mock("@/utils/platform", () => ({
  getPlatform: async () => "linux",
  isMobileShell: () => h.isMobileShell(),
}));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: h.useSessionStore }));
vi.mock("@/stores/uiStore", () => ({ useUIStore: h.useUIStore }));
vi.mock("@/stores/teamSessionStore", () => ({ useTeamSessionStore: h.useTeamSessionStore }));
vi.mock("@/i18n", () => ({
  default: { t: (k: string, o?: Record<string, unknown>) => (o === undefined ? k : `${k}:${JSON.stringify(o)}`) },
}));

import { useNotificationStore } from "@/stores/notificationStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  reconcileInvites,
  reconcileSessions,
  reconcileControlRequests,
  reconcileAwaitingKeys,
  resetTeamInboxState,
} from "./teamInbox";
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
  h.getCurrentUserEmail.mockClear().mockResolvedValue("me@x");
  h.isMobileShell.mockClear().mockReturnValue(false);
  h.joinSession.mockClear().mockResolvedValue("local-99");
  h.grantControl.mockClear();
  h.declineSessionInvite.mockClear();
  h.fetchActiveSessions.mockClear().mockResolvedValue(undefined);
  h.uiState.setActiveNav.mockClear();
  h.sessionState.sessions = [];
  h.sessionState.activeSessionId = null;
  useTeamStore.setState({ teams: [] });
  resetTeamInboxState();
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

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: "mp-1",
    connection_name: "web-prod",
    host_user_id: "host1",
    host_public_key: "pk",
    visibility: "team",
    created_at: "2026-08-13T00:00:00Z",
    participant_count: 1,
    ...overrides,
  };
}

test("a shared session becomes one entry, idempotently", () => {
  reconcileSessions([session({ id: "s1" })], new Set(), "me");
  reconcileSessions([session({ id: "s1" })], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(1);
});

test("an ended session is retracted", () => {
  reconcileSessions([session({ id: "s1" })], new Set(), "me");
  reconcileSessions([], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(0);
});

test("a session already joined is shown as resolved rather than offering Join again", () => {
  reconcileSessions([session({ id: "s1" })], new Set(["s1"]), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1")!;
  expect(entry.state).toBe("resolved");
});

// Live two-account run: the host's own bell read "A teammate shared ssh-host-1"
// about the terminal the host had just shared.
test("a session I host is not knocked into my own inbox", () => {
  reconcileSessions([session({ id: "s1", host_user_id: "me" })], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(0);
});

test("a session I host is retracted once my user id resolves", () => {
  reconcileSessions([session({ id: "s1", host_user_id: "me" })], new Set(), null);
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(1);
  reconcileSessions([session({ id: "s1", host_user_id: "me" })], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(0);
});

// Live two-account run: after the guest left, the entry offered Join again but
// stayed styled as resolved, so the button never rendered and the session
// could not be rejoined from the inbox.
test("leaving a joined session returns its entry to pending so Join renders again", () => {
  reconcileSessions([session({ id: "s1" })], new Set(["s1"]), "me");
  expect(get().inbox.find((e) => e.id === "session:s1")!.state).toBe("resolved");

  reconcileSessions([session({ id: "s1" })], new Set(), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1")!;
  expect(entry.state).toBe("pending");
  expect(entry.resolution).toBeUndefined();
  expect(entry.actions).toHaveLength(1);
});

// Mobile deliberately never renders multiplayer sessions, so a Join button
// there opened a websocket and then landed the user on "No active sessions".
// The knock stays; only the action goes.
test("the shared-session knock offers Join on desktop but not on mobile", () => {
  reconcileSessions([session({ id: "s1" })], new Set(), "me");
  expect(get().inbox.find((e) => e.id === "session:s1")!.actions).toHaveLength(1);

  h.isMobileShell.mockReturnValue(true);
  reconcileSessions([session({ id: "s1" })], new Set(), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1")!;
  expect(entry.actions).toEqual([]);
  // Still knocked, still unread — only the dead-end button is withheld.
  expect(entry.state).toBe("pending");
  expect(entry.message).toContain("notifications.inbox.session.message");
});

test("derives an invite entry with invite wording when invited_by is set", () => {
  reconcileSessions([session({ id: "s1", invited_by: "alice" })], new Set(), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1");
  expect(entry?.kind).toBe("sessionInvite");
  expect(entry?.message).toContain("notifications.inbox.sessionInvite.message");
});

test("keeps one entry when a session is both broadcast and directly invited", () => {
  reconcileSessions([session({ id: "s1", invited_by: "alice" })], new Set(), "me");
  reconcileSessions([session({ id: "s1", invited_by: null })], new Set(), "me");
  const entries = get().inbox.filter((e) => e.id === "session:s1");
  expect(entries).toHaveLength(1);
  expect(entries[0].kind).toBe("sessionShared");
});

test("toasts an invite once across repeated reconciles", () => {
  const sessions = [session({ id: "s1", invited_by: "alice" })];
  reconcileSessions(sessions, new Set(), "me");
  reconcileSessions(sessions, new Set(), "me");
  expect(
    get().toasts.filter((t) => t.message.includes("notifications.inbox.sessionInvite.message")),
  ).toHaveLength(1);
});

test("does not toast a broadcast share", () => {
  reconcileSessions([session({ id: "s2", invited_by: null })], new Set(), "me");
  expect(get().toasts).toHaveLength(0);
});

// The inviter's display name comes from participants, which an invitee who
// hasn't joined yet may not have — the fallback must still read sensibly.
test("falls back to a generic inviter name when the inviter is not in participants", () => {
  reconcileSessions([session({ id: "s1", invited_by: "alice" })], new Set(), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1");
  expect(entry?.message).toContain("notifications.inbox.someone");
});

test("uses the inviter's display name from participants when available", () => {
  reconcileSessions(
    [session({ id: "s1", invited_by: "alice", participants: [{ user_id: "alice", display_name: "Alice" }] })],
    new Set(),
    "me",
  );
  const entry = get().inbox.find((e) => e.id === "session:s1");
  expect(entry?.message).toContain("\"inviter\":\"Alice\"");
});

test("a redacted invite renders as a knock from the inviter alone", () => {
  reconcileSessions(
    [
      session({
        connection_name: null,
        invited_by: "u-stranger",
        participants: [{ user_id: "u-stranger", display_name: "@kevin-p" }],
      }),
    ],
    new Set(),
    "me",
  );
  const entry = get().inbox.find((e) => e.kind === "sessionKnock")!;
  expect(entry.message).toContain("@kevin-p");
  expect(entry.message).not.toContain("web-prod");
  expect(entry.actions.map((a) => a.label)).toEqual([
    "notifications.inbox.sessionKnock.join",
    "notifications.inbox.sessionKnock.decline",
    "notifications.inbox.sessionKnock.blockPermanently",
  ]);
});

test("decline calls the server and retracts the entry", async () => {
  h.declineSessionInvite.mockResolvedValue(undefined);
  reconcileSessions([session({ connection_name: null, invited_by: "u-stranger" })], new Set(), "me");
  const entry = get().inbox.find((e) => e.kind === "sessionKnock")!;
  await entry.actions[1].run();
  expect(h.declineSessionInvite).toHaveBeenCalledWith("mp-1", { permanent: false });
  expect(get().inbox.find((e) => e.id === entry.id)).toBeUndefined();
});

test("block permanently passes the flag", async () => {
  h.declineSessionInvite.mockResolvedValue(undefined);
  reconcileSessions([session({ connection_name: null, invited_by: "u-stranger" })], new Set(), "me");
  const entry = get().inbox.find((e) => e.kind === "sessionKnock")!;
  await entry.actions[2].run();
  expect(h.declineSessionInvite).toHaveBeenCalledWith("mp-1", { permanent: true });
});

test("a teammate invite is unchanged", () => {
  reconcileSessions([session({ connection_name: "web-prod", invited_by: "u-mate" })], new Set(), "me");
  expect(get().inbox.find((e) => e.kind === "sessionInvite")).toBeTruthy();
});

test("running the inbox Join action opens a session tab, not just a websocket", async () => {
  reconcileSessions([session({ id: "s1" })], new Set(), "me");
  await get().runInboxAction("session:s1", 0);

  expect(h.joinSession).toHaveBeenCalledWith("s1", "me@x", expect.any(Function), undefined);
  // The bug this regression test guards against: joining without ever adding
  // a sessionStore tab left MultiplayerBar (keyed off that tab id) with
  // nothing to render.
  expect(h.sessionState.sessions).toHaveLength(1);
  expect(h.sessionState.sessions[0]).toMatchObject({
    id: "local-99",
    connectionId: "s1",
    connectionName: "web-prod",
    status: "connected",
    type: "multiplayer",
  });
  expect(h.sessionState.activeSessionId).toBe("local-99");
  expect(h.uiState.setActiveNav).toHaveBeenCalledWith("terminal");
});

function conn(over: Record<string, unknown> = {}) {
  return {
    multiplayerSessionId: "mp1",
    role: "host",
    myUserId: "me",
    participants: [{ user_id: "guest1", display_name: "Bob" }],
    controlHolder: "me",
    controlRequester: null,
    connection: {},
    ...over,
  } as never;
}

test("a host with a pending requester gets one actionable entry", () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  const e = get().inbox.find((x) => x.kind === "controlRequest")!;
  expect(e.id).toBe("control:local1:guest1");
  expect(e.actions).toHaveLength(2);
});

test("a guest never gets a control-request entry for their own request", () => {
  reconcileControlRequests({ local1: conn({ role: "guest", myUserId: "guest1", controlRequester: "guest1" }) });
  expect(get().inbox.filter((x) => x.kind === "controlRequest")).toHaveLength(0);
});

test("the entry retracts when the request clears", () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  reconcileControlRequests({ local1: conn({ controlRequester: null }) });
  expect(get().inbox.filter((x) => x.kind === "controlRequest")).toHaveLength(0);
});

test("a new control request toasts exactly once across repeated reconciles", () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  expect(get().toasts).toHaveLength(1);
});

test("a pending request on a session that then ends is retracted, not left dangling", () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1", ended: true }) });
  expect(get().inbox.filter((x) => x.kind === "controlRequest")).toHaveLength(0);
});

test("Grant runs grantControl with the local session id and requester id", async () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  await get().runInboxAction("control:local1:guest1", 0);
  expect(h.grantControl).toHaveBeenCalledWith("local1", "guest1");
});

test("Deny retracts the entry locally and calls nothing on the connection", async () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  await get().runInboxAction("control:local1:guest1", 1);
  expect(get().inbox.filter((x) => x.kind === "controlRequest")).toHaveLength(0);
  expect(h.grantControl).not.toHaveBeenCalled();
});

// Deny deletes no source row, so the unchanged connection re-derives the entry
// on the next reconcile — and the toast dedupe, keyed off the inbox, saw the
// retracted id as new and knocked again.
test("a denied request stays gone across later reconciles of the same source", async () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  await get().runInboxAction("control:local1:guest1", 1);
  useNotificationStore.setState({ toasts: [] });

  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  expect(get().inbox.filter((x) => x.kind === "controlRequest")).toHaveLength(0);
  expect(get().toasts).toHaveLength(0);
});

test("a fresh request from the same guest knocks again after a deny", async () => {
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  await get().runInboxAction("control:local1:guest1", 1);
  useNotificationStore.setState({ toasts: [] });

  reconcileControlRequests({ local1: conn({ controlRequester: null }) });
  reconcileControlRequests({ local1: conn({ controlRequester: "guest1" }) });
  expect(get().inbox.filter((x) => x.kind === "controlRequest")).toHaveLength(1);
  expect(get().toasts).toHaveLength(1);
});

test("a guest handed control gets one confirmation toast per grant", () => {
  const guest = (over: Record<string, unknown> = {}) =>
    conn({ role: "guest", myUserId: "guest1", controlHolder: "me", ...over });

  reconcileControlRequests({ local1: guest() });
  expect(get().toasts).toHaveLength(0);

  reconcileControlRequests({ local1: guest({ controlHolder: "guest1" }) });
  reconcileControlRequests({ local1: guest({ controlHolder: "guest1" }) });
  expect(get().toasts).toHaveLength(1);
  expect(get().toasts[0].message).toContain("notifications.inbox.control.granted");

  reconcileControlRequests({ local1: guest() });
  reconcileControlRequests({ local1: guest({ controlHolder: "guest1" }) });
  expect(get().toasts).toHaveLength(2);
});

test("the host holding control on their own session is not toasted", () => {
  reconcileControlRequests({ local1: conn({ controlHolder: "me" }) });
  expect(get().toasts).toHaveLength(0);
});

test("a team awaiting its vault key yields exactly one entry, and it clears once the key loads", () => {
  useTeamStore.setState({
    teams: [
      { id: "t1", name: "Acme", owner_id: "o1", owner_tier: "pro", created_at: "2026-08-13T00:00:00Z", role_ids: [] },
      { id: "t2", name: "Beta", owner_id: "o1", owner_tier: "pro", created_at: "2026-08-13T00:00:00Z", role_ids: [] },
    ],
  });

  reconcileAwaitingKeys({ t1: "awaiting_key", t2: "loaded" });
  expect(get().inbox.filter((e) => e.kind === "awaitingKey")).toHaveLength(1);
  expect(get().inbox.find((e) => e.kind === "awaitingKey")?.id).toBe("awaiting-key:t1");
  expect(get().inbox.find((e) => e.kind === "awaitingKey")?.actions).toEqual([]);

  reconcileAwaitingKeys({ t1: "loaded", t2: "loaded" });
  expect(get().inbox.filter((e) => e.kind === "awaitingKey")).toHaveLength(0);
});
