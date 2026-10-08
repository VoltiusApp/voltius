import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const renders = vi.hoisted(() => new Map<string, number>());

vi.mock("@/components/terminal/SessionView", () => ({
  HostAwareTerminalView: ({ session }: { session: { id: string } }) => {
    renders.set(session.id, (renders.get(session.id) ?? 0) + 1);
    return null;
  },
  SessionConnectionOverlay: () => null,
}));
vi.mock("@/components/terminal/MultiplayerTerminalView", () => ({ default: () => null }));
vi.mock("@/components/terminal/MultiplayerBar", () => ({ MultiplayerBar: () => null }));
vi.mock("@/components/team/TeamVaultStatePanel", () => ({ default: () => null }));
vi.mock("@/components/home/HomePage", () => ({ default: () => null }));
vi.mock("@/components/hosts/HostsPage", () => ({ default: () => null }));
vi.mock("@/components/keychain/KeychainPage", () => ({ default: () => null }));
vi.mock("@/components/known-hosts/KnownHostsPage", () => ({ default: () => null }));
vi.mock("@/components/placeholder/PlaceholderPage", () => ({ default: () => null }));
vi.mock("@/components/filetransfer/SFTPPage", () => ({ default: () => null }));
vi.mock("@/components/snippets/SnippetsPage", () => ({ SnippetsPage: () => null }));
vi.mock("@/components/port_forwarding/PortForwardingPage", () => ({ PortForwardingPage: () => null }));
vi.mock("@/components/members/MembersPage", () => ({ default: () => null }));
vi.mock("@/components/logs/AuditLogsPage", () => ({ default: () => null }));
vi.mock("@/components/panes/PaneTerminal", () => ({ EmptySplitPane: () => null }));
vi.mock("@/components/panes/PaneView", () => ({ PaneView: () => null }));
vi.mock("@/components/panes/usePaneDragController", () => ({ usePaneDragController: () => {} }));
vi.mock("@/components/panes/DropZones", () => ({ DropZones: () => null }));
vi.mock("@/components/panes/DragGhost", () => ({ DragGhost: () => null }));
vi.mock("@/hooks/useHostPingPolling", () => ({ useHostPingPolling: () => {} }));
vi.mock("@/hooks/useBlockedTeamVault", () => ({ useBlockedTeamVault: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import MainPanel from "./MainPanel";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import type { TerminalSession } from "@/types";

const session = (id: string): TerminalSession => ({ id, connectionId: "local", connectionName: id, status: "connected", type: "local" });

afterEach(() => {
  cleanup();
  renders.clear();
  useSessionStore.setState({ sessions: [], activeSessionId: null });
});

test("switching tabs re-renders only the tabs whose state changed", () => {
  useVaultStore.setState({ selectedVaultIds: ["v"] });
  useUIStore.setState({ activeNav: "terminal", homeView: false, sftpPanelOpen: false });
  useSessionStore.setState({ sessions: ["a", "b", "c", "d"].map(session), activeSessionId: "a" });
  render(<MainPanel />);
  renders.clear();

  act(() => useSessionStore.setState({ activeSessionId: "b" }));
  expect(Object.fromEntries(renders)).toEqual({ a: 1, b: 1 });

  renders.clear();
  act(() => useSessionStore.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === "c" ? { ...x, status: "disconnected" } : x)) })));
  expect(Object.fromEntries(renders)).toEqual({ c: 1 });
});
