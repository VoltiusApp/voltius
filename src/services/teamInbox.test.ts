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
  const useTeamSessionStore = { getState: () => ({ joinSession, grantControl }) };
  return {
    accept: vi.fn(async () => {}),
    decline: vi.fn(async () => {}),
    getCurrentUserEmail: vi.fn(async () => "me@x" as string | null),
    isMobileShell: vi.fn(() => false),
    sessionState,
    useSessionStore,
    uiState,
    useUIStore,
    joinSession,
    grantControl,
    useTeamSessionStore,
  };
});
vi.mock("@/services/invitationActions", () => ({
  acceptInvitation: h.accept,
  declineInvitation: h.decline,
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
  default: { t: (k: string, o?: Record<string, unknown>) => `${k}:${JSON.stringify(o ?? {})}` },
}));

import { useNotificationStore } from "@/stores/notificationStore";
import { useTeamStore } from "@/stores/teamStore";
import { reconcileInvites, reconcileSessions, reconcileControlRequests, reconcileAwaitingKeys } from "./teamInbox";
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
  h.uiState.setActiveNav.mockClear();
  h.sessionState.sessions = [];
  h.sessionState.activeSessionId = null;
  useTeamStore.setState({ teams: [] });
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

function session(id: string, hostUserId = "host1"): ActiveSession {
  return {
    id,
    connection_name: "web-prod",
    host_user_id: hostUserId,
    host_public_key: "pk",
    visibility: "team",
    created_at: "2026-08-13T00:00:00Z",
    participant_count: 1,
  };
}

test("a shared session becomes one entry, idempotently", () => {
  reconcileSessions([session("s1")], new Set(), "me");
  reconcileSessions([session("s1")], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(1);
});

test("an ended session is retracted", () => {
  reconcileSessions([session("s1")], new Set(), "me");
  reconcileSessions([], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(0);
});

test("a session already joined is shown as resolved rather than offering Join again", () => {
  reconcileSessions([session("s1")], new Set(["s1"]), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1")!;
  expect(entry.state).toBe("resolved");
});

// Live two-account run: the host's own bell read "A teammate shared ssh-host-1"
// about the terminal the host had just shared.
test("a session I host is not knocked into my own inbox", () => {
  reconcileSessions([session("s1", "me")], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(0);
});

test("a session I host is retracted once my user id resolves", () => {
  reconcileSessions([session("s1", "me")], new Set(), null);
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(1);
  reconcileSessions([session("s1", "me")], new Set(), "me");
  expect(get().inbox.filter((e) => e.kind === "sessionShared")).toHaveLength(0);
});

// Live two-account run: after the guest left, the entry offered Join again but
// stayed styled as resolved, so the button never rendered and the session
// could not be rejoined from the inbox.
test("leaving a joined session returns its entry to pending so Join renders again", () => {
  reconcileSessions([session("s1")], new Set(["s1"]), "me");
  expect(get().inbox.find((e) => e.id === "session:s1")!.state).toBe("resolved");

  reconcileSessions([session("s1")], new Set(), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1")!;
  expect(entry.state).toBe("pending");
  expect(entry.resolution).toBeUndefined();
  expect(entry.actions).toHaveLength(1);
});

// Mobile deliberately never renders multiplayer sessions, so a Join button
// there opened a websocket and then landed the user on "No active sessions".
// The knock stays; only the action goes.
test("the shared-session knock offers Join on desktop but not on mobile", () => {
  reconcileSessions([session("s1")], new Set(), "me");
  expect(get().inbox.find((e) => e.id === "session:s1")!.actions).toHaveLength(1);

  h.isMobileShell.mockReturnValue(true);
  reconcileSessions([session("s1")], new Set(), "me");
  const entry = get().inbox.find((e) => e.id === "session:s1")!;
  expect(entry.actions).toEqual([]);
  // Still knocked, still unread — only the dead-end button is withheld.
  expect(entry.state).toBe("pending");
  expect(entry.message).toContain("notifications.inbox.session.message");
});

test("running the inbox Join action opens a session tab, not just a websocket", async () => {
  reconcileSessions([session("s1")], new Set(), "me");
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
