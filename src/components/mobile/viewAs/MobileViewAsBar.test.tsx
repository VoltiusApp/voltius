import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { initialMobileNavState, type MobileScreen, type MobileTab } from "@/stores/mobileNavCore";
import { runBack } from "@/hooks/useAndroidBack";
import { makeMember, makeTeam } from "@/test/team";
import { PREVIEW_SESSION, startPreview, stopPreview } from "@/test/preview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<typeof import("@/utils/platform")>()), isMobileShell: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/sync", () => ({ onTeamSseEvent: () => () => {} }));
vi.mock("@/services/permissionPreview", async (orig) => ({
  ...(await orig<typeof import("@/services/permissionPreview")>()),
  previewPermissions: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/components/preview/MemberAccessPanel", () => ({ MemberAccessPanel: () => <div data-testid="member-access-panel" /> }));

import MobileViewAsBar from "./MobileViewAsBar";
import MobileViewAsSheets from "./MobileViewAsSheets";

const MEMBER_SCREEN: { tab: MobileTab; stack: MobileScreen[] } = {
  tab: "more",
  stack: [{ kind: "more-page", page: "members" }, { kind: "member", teamId: "team-1", userId: "bob" }],
};

const previewFromMemberScreen = () => {
  useMobileNavStore.setState({ ...initialMobileNavState, previewReturn: MEMBER_SCREEN });
  startPreview();
};

const expectNav = (tab: MobileTab, stack: MobileScreen[]) => {
  const nav = useMobileNavStore.getState();
  expect({ tab: nav.tab, stack: nav.stack }).toEqual({ tab, stack });
};

const expectRestored = () => {
  expect(usePreviewStore.getState().session).toBeNull();
  expectNav(MEMBER_SCREEN.tab, MEMBER_SCREEN.stack);
  expect(useMobileNavStore.getState().previewReturn).toBeNull();
};

const back = () => {
  let handled = false;
  act(() => { handled = runBack(); });
  expect(handled).toBe(true);
};

beforeEach(() => {
  useTeamStore.setState({ membersByTeam: { "team-1": [makeMember("bob", [], { member_name: "Bob" })] }, rolesByTeam: {} });
});
afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.getState().exit();
  usePreviewStore.setState({ status: "idle", error: null, draft: null });
  useMobileNavStore.setState({ ...initialMobileNavState, previewReturn: null });
});

test("bar_shows_subject_and_status_and_close_exits", () => {
  startPreview();
  usePreviewStore.setState({ status: "loading" });
  render(<MobileViewAsBar />);
  const bar = document.querySelector("[data-mobile-view-as-bar]")!;
  expect(bar.textContent).toContain("members.viewAs.viewingAs");
  expect(screen.getByTestId("view-as-loading")).toBeTruthy();
  const close = document.querySelector<HTMLElement>("[data-view-as-close]")!;
  expect(close.getAttribute("aria-label")).toBe("members.viewAs.exit");
  fireEvent.click(close);
  expect(usePreviewStore.getState().session).toBeNull();
});

test("bar_not_rendered_outside_a_preview", () => {
  render(<MobileViewAsBar />);
  expect(document.querySelector("[data-mobile-view-as-bar]")).toBeNull();
});

test("bar_access_button_shows_access", () => {
  startPreview();
  render(<MobileViewAsBar />);
  const btn = document.querySelector<HTMLElement>("[data-view-as-access]")!;
  expect(btn.getAttribute("aria-label")).toBe("mobile.viewAs.editAccess");
  expect(btn.querySelector("[data-icon='lucide:sliders-horizontal']")).not.toBeNull();
  fireEvent.click(btn);
  expect(usePreviewStore.getState().side).toEqual({ kind: "access" });
});

test("close_without_draft_exits_and_restores_the_member_screen", () => {
  previewFromMemberScreen();
  render(<MobileViewAsBar />);
  fireEvent.click(document.querySelector<HTMLElement>("[data-view-as-close]")!);
  expectRestored();
});

test("back_at_root_with_draft_asks_then_restores", () => {
  previewFromMemberScreen();
  usePreviewStore.setState({ draft: { permissions: 1 } });
  render(<MobileViewAsBar />);
  back();
  expect(usePreviewStore.getState().session).not.toBeNull();
  expectNav("hosts", []);
  fireEvent.click(screen.getByText("members.viewAs.discardDraft.confirm"));
  expectRestored();
});

test("back_in_a_page_pops_before_exiting", () => {
  previewFromMemberScreen();
  render(<MobileViewAsBar />);
  act(() => useMobileNavStore.getState().push({ kind: "more-page", page: "keychain" }));
  back();
  expect(usePreviewStore.getState().session).not.toBeNull();
  expectNav("hosts", []);
  back();
  expectRestored();
});

test("back_on_another_tab_goes_to_hosts_before_exiting", () => {
  previewFromMemberScreen();
  render(<MobileViewAsBar />);
  act(() => useMobileNavStore.getState().setTab("snippets"));
  back();
  expect(usePreviewStore.getState().session).not.toBeNull();
  expectNav("hosts", []);
  back();
  expectRestored();
});

test("back_with_the_access_sheet_open_closes_the_sheet_first", async () => {
  previewFromMemberScreen();
  usePreviewStore.setState({ side: { kind: "access" } });
  render(<><MobileViewAsBar /><MobileViewAsSheets /></>);
  back();
  await waitFor(() => expect(usePreviewStore.getState().side).toBeNull());
  expect(usePreviewStore.getState().session).not.toBeNull();
  back();
  expectRestored();
});

test("involuntary_exit_does_not_restore_and_clears_the_return_point", () => {
  useVaultStore.setState({ selectedVaultIds: ["personal", "team-1"] });
  useTeamStore.setState({ teams: [makeTeam("team-1")] });
  useMobileNavStore.setState({ ...initialMobileNavState, previewReturn: MEMBER_SCREEN });
  render(<MobileViewAsBar />);
  act(() => usePreviewStore.getState().enter(PREVIEW_SESSION));
  expect(usePreviewStore.getState().session).not.toBeNull();
  act(() => useVaultStore.getState().selectVaultOnly("personal"));
  expect(usePreviewStore.getState().session).toBeNull();
  expectNav("hosts", []);
  expect(useMobileNavStore.getState().previewReturn).toBeNull();
});
