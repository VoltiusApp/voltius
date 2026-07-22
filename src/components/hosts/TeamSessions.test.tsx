import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

vi.mock("@/components/shared/AvatarStack", () => ({
  AvatarStack: ({ participants, count }: { participants?: { name: string }[]; count?: number }) => (
    <div data-testid="avatars">{(participants?.length ?? 0)}/{count ?? 0}</div>
  ),
}));
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="card" onClick={onClick}>{children}</div>
  ),
}));

interface TeamState {
  activeSessions: unknown[];
  fetchActiveSessions: ReturnType<typeof vi.fn>;
  joinSession: ReturnType<typeof vi.fn>;
  connections: Record<string, { multiplayerSessionId: string; participants?: { display_name: string }[] }>;
}
interface SessionState {
  sessions: unknown[];
  setActive: ReturnType<typeof vi.fn>;
}
interface UIState {
  setActiveNav: ReturnType<typeof vi.fn>;
  homeView: boolean;
}

const h = vi.hoisted(() => {
  const teamState: TeamState = {
    activeSessions: [],
    fetchActiveSessions: vi.fn(async () => {}),
    joinSession: vi.fn(async () => "local-1"),
    connections: {},
  };
  const useTeamSessionStore: any = (sel?: (s: TeamState) => unknown) => (sel ? sel(teamState) : teamState);
  useTeamSessionStore.getState = () => teamState;
  useTeamSessionStore.setState = (patch: any) =>
    Object.assign(teamState, typeof patch === "function" ? patch(teamState) : patch);

  const sessionState: SessionState = { sessions: [], setActive: vi.fn() };
  const useSessionStore: any = (sel?: (s: SessionState) => unknown) => (sel ? sel(sessionState) : sessionState);
  useSessionStore.getState = () => sessionState;
  useSessionStore.setState = (patch: any) =>
    Object.assign(sessionState, typeof patch === "function" ? patch(sessionState) : patch);

  const uiState: UIState = { setActiveNav: vi.fn(), homeView: true };
  const useUIStore: any = (sel?: (s: UIState) => unknown) => (sel ? sel(uiState) : uiState);
  useUIStore.getState = () => uiState;
  useUIStore.setState = (patch: any) => Object.assign(uiState, typeof patch === "function" ? patch(uiState) : patch);

  return {
    teamState,
    useTeamSessionStore,
    sessionState,
    useSessionStore,
    uiState,
    useUIStore,
    getMyUserId: vi.fn(async () => "me" as string | null),
    getCurrentUserEmail: vi.fn(async () => "me@x" as string | null),
    accessibleVaultIds: vi.fn(() => ["team-1"] as string[]),
  };
});

vi.mock("@/services/teamService", () => ({ getMyUserId: () => h.getMyUserId() }));
vi.mock("@/services/account", () => ({ getCurrentUserEmail: () => h.getCurrentUserEmail() }));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useAccessibleVaultIds: () => h.accessibleVaultIds() }));
vi.mock("@/stores/teamSessionStore", () => ({ useTeamSessionStore: h.useTeamSessionStore }));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: h.useSessionStore }));
vi.mock("@/stores/uiStore", () => ({ useUIStore: h.useUIStore }));

const { teamState, sessionState, uiState, getMyUserId, getCurrentUserEmail, accessibleVaultIds } = h;

import { TeamSessions } from "./TeamSessions";

const active = (o: Partial<{
  id: string; connection_name: string; host_user_id: string;
  participant_count: number; participants: { user_id: string; display_name: string }[]; vault_ids: string[];
}> = {}) => ({
  id: o.id ?? "sess-1",
  connection_name: o.connection_name ?? "Prod DB",
  host_user_id: o.host_user_id ?? "host-1",
  host_public_key: "",
  visibility: "team",
  created_at: "",
  participant_count: o.participant_count ?? 0,
  participants: o.participants,
  vault_ids: o.vault_ids,
});

beforeEach(() => {
  teamState.activeSessions = [];
  teamState.fetchActiveSessions = vi.fn(async () => {});
  teamState.joinSession = vi.fn(async () => "local-1");
  teamState.connections = {};
  sessionState.sessions = [];
  sessionState.setActive = vi.fn();
  uiState.setActiveNav = vi.fn();
  uiState.homeView = true;
  accessibleVaultIds.mockReturnValue(["team-1"]);
  getMyUserId.mockReset().mockResolvedValue("me");
  getCurrentUserEmail.mockReset().mockResolvedValue("me@x");
});
afterEach(() => cleanup());

// ── Session scoping ─────────────────────────────────────────────────────────

test("homeView=true shows all sessions regardless of vault", async () => {
  uiState.homeView = true;
  teamState.activeSessions = [active({ id: "a", vault_ids: ["other"] })];
  render(<TeamSessions />);
  expect(screen.getByText("Prod DB")).toBeTruthy();
  expect(screen.getAllByTestId("card")).toHaveLength(1);
});

test("homeView=false hides sessions whose vaults don't overlap accessible vaults", async () => {
  uiState.homeView = false;
  teamState.activeSessions = [active({ id: "a", host_user_id: "host-1", vault_ids: ["other"] })];
  getMyUserId.mockResolvedValue("me");
  render(<TeamSessions />);
  await waitFor(() => expect(getMyUserId).toHaveBeenCalled());
  expect(screen.queryByTestId("card")).toBeNull();
  expect(screen.getByText("hosts.teamSessions.joinByCode")).toBeTruthy();
});

test("homeView=false includes overlapping-vault session", async () => {
  uiState.homeView = false;
  teamState.activeSessions = [active({ id: "a", host_user_id: "host-1", vault_ids: ["team-1"] })];
  render(<TeamSessions />);
  expect(screen.getByText("Prod DB")).toBeTruthy();
});

test("homeView=false always includes a session I host even with non-overlapping vault", async () => {
  uiState.homeView = false;
  teamState.activeSessions = [active({ id: "a", host_user_id: "me", vault_ids: ["other"] })];
  getMyUserId.mockResolvedValue("me");
  render(<TeamSessions />);
  await waitFor(() => expect(screen.getByText("Prod DB")).toBeTruthy());
});

test("session with empty vault_ids and not mine is excluded", async () => {
  uiState.homeView = false;
  teamState.activeSessions = [active({ id: "a", host_user_id: "host-1", vault_ids: [] })];
  getMyUserId.mockResolvedValue("me");
  render(<TeamSessions />);
  await waitFor(() => expect(getMyUserId).toHaveBeenCalled());
  expect(screen.queryByTestId("card")).toBeNull();
  expect(screen.getByText("hosts.teamSessions.joinByCode")).toBeTruthy();
});

// ── Join-by-code modal ──────────────────────────────────────────────────────

test("empty-state join-by-code button opens modal", () => {
  teamState.activeSessions = [];
  render(<TeamSessions />);
  fireEvent.click(screen.getByText("hosts.teamSessions.joinByCode"));
  expect(screen.getByPlaceholderText("hosts.teamSessions.inviteCodePlaceholder")).toBeTruthy();
});

test("invalid code format shows invalidCodeFormat error, does not join", () => {
  teamState.activeSessions = [];
  render(<TeamSessions />);
  fireEvent.click(screen.getByText("hosts.teamSessions.joinByCode"));
  const input = screen.getByPlaceholderText("hosts.teamSessions.inviteCodePlaceholder");
  fireEvent.change(input, { target: { value: "nocolon" } });
  fireEvent.click(screen.getByText("hosts.teamSessions.join"));
  expect(screen.getByText("hosts.teamSessions.invalidCodeFormat")).toBeTruthy();
  expect(teamState.joinSession).not.toHaveBeenCalled();
});

test("valid code calls joinSession with sessionId + token", async () => {
  teamState.activeSessions = [];
  render(<TeamSessions />);
  fireEvent.click(screen.getByText("hosts.teamSessions.joinByCode"));
  const input = screen.getByPlaceholderText("hosts.teamSessions.inviteCodePlaceholder");
  fireEvent.change(input, { target: { value: "sess-9:tok-9" } });
  fireEvent.click(screen.getByText("hosts.teamSessions.join"));
  await waitFor(() =>
    expect(teamState.joinSession).toHaveBeenCalledWith("sess-9", expect.any(String), expect.any(Function), "tok-9"),
  );
});

test("blank code is a no-op (join button disabled)", () => {
  teamState.activeSessions = [];
  render(<TeamSessions />);
  fireEvent.click(screen.getByText("hosts.teamSessions.joinByCode"));
  const joinBtn = screen.getByText("hosts.teamSessions.join").closest("button");
  expect(joinBtn).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByText("hosts.teamSessions.join"));
  expect(teamState.joinSession).not.toHaveBeenCalled();
});

// ── Join / resume card click ────────────────────────────────────────────────

test("clicking a card I'm not in calls joinSession then setActiveNav(terminal)", async () => {
  uiState.homeView = true;
  teamState.activeSessions = [active({ id: "s1" })];
  teamState.connections = {};
  render(<TeamSessions />);
  fireEvent.click(screen.getByTestId("card"));
  await waitFor(() => expect(teamState.joinSession).toHaveBeenCalled());
  await waitFor(() => expect(uiState.setActiveNav).toHaveBeenCalledWith("terminal"));
});

test("clicking a card I'm already in resumes (setActive) and does not join", async () => {
  uiState.homeView = true;
  teamState.activeSessions = [active({ id: "s1" })];
  teamState.connections = { "local-x": { multiplayerSessionId: "s1" } };
  render(<TeamSessions />);
  expect(screen.getByText("hosts.teamSessions.resume")).toBeTruthy();
  expect(screen.queryByText("hosts.teamSessions.join")).toBeNull();
  fireEvent.click(screen.getByTestId("card"));
  expect(sessionState.setActive).toHaveBeenCalledWith("local-x");
  expect(teamState.joinSession).not.toHaveBeenCalled();
});

// ── Participant resolution ──────────────────────────────────────────────────

test("participant list prefers live WS connection participants over server participants", () => {
  uiState.homeView = true;
  teamState.activeSessions = [
    active({ id: "s1", participants: [{ user_id: "u1", display_name: "ServerName" }] }),
  ];
  teamState.connections = {
    "local-1": {
      multiplayerSessionId: "s1",
      participants: [{ display_name: "LiveA" }, { display_name: "LiveB" }],
    },
  };
  render(<TeamSessions />);
  expect(screen.getByTestId("avatars").textContent).toBe("2/0");
});

test("falls back to server participants when not in the session", () => {
  uiState.homeView = true;
  teamState.activeSessions = [
    active({
      id: "s1",
      participants: [
        { user_id: "u1", display_name: "A" },
        { user_id: "u2", display_name: "B" },
      ],
    }),
  ];
  teamState.connections = {};
  render(<TeamSessions />);
  expect(screen.getByTestId("avatars").textContent).toBe("2/0");
});

// ── Polling effect ──────────────────────────────────────────────────────────

test("mounts and calls fetchActiveSessions on mount", async () => {
  render(<TeamSessions />);
  await waitFor(() => expect(teamState.fetchActiveSessions).toHaveBeenCalled());
});
