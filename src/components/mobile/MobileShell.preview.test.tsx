import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/teamVaultSync", () => ({ fetchTeamData: vi.fn(async () => {}) }));

vi.mock("./MobileSessionLayer", () => ({ default: () => null }));
vi.mock("@/hooks/usePfToastBridge", () => ({ usePfToastBridge: () => {} }));
vi.mock("./screens/MobileHostsScreen", () => ({ default: () => <Probe id="hosts" /> }));
vi.mock("./screens/MobileKeychainScreen", () => ({ default: () => <Probe id="keychain" /> }));
vi.mock("./sheets/HostActionsSheet", () => ({ default: () => <Probe id="host-actions" /> }));
vi.mock("./sheets/VaultSwitcherSheet", () => ({ default: () => <Probe id="vault-switcher" /> }));
vi.mock("@/components/hosts/TeamSessions", () => ({ TeamSessions: () => <Probe id="team-sessions" /> }));
vi.mock("./panels/MobileSftpScreen", () => ({ default: () => null }));
vi.mock("./MobileRemoteDeviceSessions", () => ({ default: () => <div>remote-sessions</div> }));

import { usePreviewActive } from "@/hooks/previewScope";
import MobileShell from "./MobileShell";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import { startPreview, stopPreview } from "@/test/preview";
import { usePreviewStore } from "@/stores/previewStore";

function Probe({ id }: { id: string }) {
  return <div data-testid={id}>{String(usePreviewActive() !== null)}</div>;
}

beforeEach(() => {
  useMobileNavStore.setState({ tab: "hosts", stack: [], sheet: null });
  useSessionStore.setState({ sessions: [] });
  startPreview();
});
afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.setState({ draft: null });
});

test("tab_screens_and_pushed_pages_are_in_the_content_scope", () => {
  useMobileNavStore.setState({ stack: [{ kind: "more-page", page: "keychain" }] });
  render(<MobileShell />);
  expect(screen.getByTestId("keychain").textContent).toBe("true");
});

test("tab screens are in the content scope", () => {
  render(<MobileShell />);
  expect(screen.getByTestId("hosts").textContent).toBe("true");
});

test("content_sheets_are_in_the_content_scope", () => {
  useMobileNavStore.setState({ sheet: { kind: "host-actions", hostId: "h1" } });
  render(<MobileShell />);
  expect(screen.getByTestId("host-actions").textContent).toBe("true");
});

test("vault_switcher_is_outside_the_content_scope", () => {
  useMobileNavStore.setState({ sheet: { kind: "vault-switcher" } });
  render(<MobileShell />);
  expect(screen.getByTestId("vault-switcher").textContent).toBe("false");
});

test("remote_device_sessions_not_rendered_while_previewing", async () => {
  const { default: Real } = await vi.importActual<typeof import("./screens/MobileHostsScreen")>("./screens/MobileHostsScreen");
  const { PreviewContentScope } = await import("@/hooks/previewScope");
  const view = render(<PreviewContentScope><Real /></PreviewContentScope>);
  expect(view.queryByText("remote-sessions")).toBeNull();
  stopPreview();
  view.rerender(<PreviewContentScope><Real /></PreviewContentScope>);
  expect(view.queryByText("remote-sessions")).not.toBeNull();
});

test("sessions_page_renders_team_sessions", () => {
  useMobileNavStore.setState({ stack: [{ kind: "more-page", page: "sessions" }] });
  render(<MobileShell />);
  expect(screen.getByTestId("team-sessions").textContent).toBe("true");
  expect(document.querySelector("[data-vt-hit-scope] [data-testid='team-sessions']")).not.toBeNull();
});

test("draft_bar_in_the_column_only_while_the_sheet_is_closed", () => {
  const bars = () => document.querySelectorAll("[data-mobile-view-as-draft]");
  const { rerender } = render(<MobileShell />);
  expect(bars().length).toBe(0);

  act(() => usePreviewStore.setState({ draft: { role_ids: [], allow: 0, deny: 0 } }));
  rerender(<MobileShell />);
  expect(bars().length).toBe(1);
  expect(bars()[0].previousElementSibling!.hasAttribute("data-mobile-tab-content")).toBe(true);
  expect(bars()[0].nextElementSibling!.hasAttribute("data-mobile-tab-bar")).toBe(true);

  act(() => usePreviewStore.setState({ side: { kind: "access" } }));
  rerender(<MobileShell />);
  expect(bars().length).toBe(1);
  expect(bars()[0].closest("[data-mobile-sheet-footer]")).not.toBeNull();
});
