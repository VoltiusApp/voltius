import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PreviewContentScope } from "@/hooks/previewScope";
import { startPreview, stopPreview } from "@/test/preview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/AvatarStack", () => ({ AvatarStack: () => null, MiniAvatar: () => null }));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="card" onClick={onClick}>{children}</div>
  ),
}));

const h = vi.hoisted(() => {
  const selectorStore = <S extends object>(state: S) =>
    Object.assign((sel?: (s: S) => unknown) => (sel ? sel(state) : state), { getState: () => state });
  return {
    granted: new Set<string>(),
    asked: [] as [string, string][],
    teamState: {
      activeSessions: [{
        id: "s1", connection_name: "Prod DB", host_user_id: "host-1", host_public_key: "", visibility: "team",
        created_at: "", participant_count: 0, vault_ids: ["team-1"],
      }],
      fetchActiveSessions: async () => {},
      connections: {},
    },
    selectorStore,
  };
});

vi.mock("@/services/teamService", () => ({ getMyUserId: async () => "me" }));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useAccessibleVaultIds: () => ["team-1"] }));
vi.mock("@/hooks/usePermission", () => ({
  usePermissions: () => (permission: string, vaultId: string) => {
    h.asked.push([permission, vaultId]);
    return h.granted.has(permission);
  },
}));
vi.mock("@/stores/teamSessionStore", () => ({ useTeamSessionStore: h.selectorStore(h.teamState) }));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: h.selectorStore({ sessions: [], setActive: vi.fn() }) }));
vi.mock("@/stores/uiStore", () => ({ useUIStore: h.selectorStore({ setActiveNav: vi.fn(), homeView: true }) }));

import { TeamSessions } from "./TeamSessions";

beforeEach(() => { h.granted = new Set(); h.asked.length = 0; });
afterEach(() => { cleanup(); stopPreview(); });

const renderSessions = () => render(<PreviewContentScope><TeamSessions /></PreviewContentScope>);

test("sessions_grey_without_view_terminal_sessions", () => {
  startPreview();
  renderSessions();

  expect(screen.getByText("members.viewAs.locked.sessions")).toBeTruthy();
  expect(screen.queryByText("Prod DB")).toBeNull();
  expect(screen.queryAllByTestId("card")).toHaveLength(0);
  expect(h.asked).toContainEqual(["VIEW_TERMINAL_SESSIONS", "team-1"]);
});

test("join controls are disabled while the subject lacks join_terminal_session", () => {
  h.granted = new Set(["VIEW_TERMINAL_SESSIONS"]);
  startPreview();
  renderSessions();

  expect(screen.getByText("Prod DB")).toBeTruthy();
  const join = screen.getByText("hosts.teamSessions.join").closest("button")!;
  expect(join.disabled).toBe(true);
  expect((screen.getByText("hosts.teamSessions.joinByCode").closest("button") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(join);
});

test("join controls are enabled once the subject holds join_terminal_session", () => {
  h.granted = new Set(["VIEW_TERMINAL_SESSIONS", "JOIN_TERMINAL_SESSION"]);
  startPreview();
  renderSessions();

  expect((screen.getByText("hosts.teamSessions.join").closest("button") as HTMLButtonElement).disabled).toBe(false);
});

test("sessions render unchanged outside a preview whatever the permissions", () => {
  renderSessions();

  expect(screen.getByText("Prod DB")).toBeTruthy();
  expect(screen.queryByText("members.viewAs.locked.sessions")).toBeNull();
  expect((screen.getByText("hosts.teamSessions.join").closest("button") as HTMLButtonElement).disabled).toBe(false);
});
