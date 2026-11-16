import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { runBack } from "@/hooks/useAndroidBack";
import { makeMember, makeRole } from "@/test/team";
import { PREVIEW_SESSION } from "@/test/preview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join("|")}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => "admin" }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: false, isOwner: true }) }));
vi.mock("@/hooks/usePermission", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePermission")>()),
  useOwnPermissions: () => () => true,
}));

vi.mock("@/components/preview/WhyPanel", () => ({ WhyPanel: () => <div data-testid="why-panel" /> }));

import MobileViewAsSheets from "./MobileViewAsSheets";

const showWhy = () => usePreviewStore.setState({ side: { kind: "why", type: "connection", objectId: "c1" } });

const PREVIEW_RESULT = {
  locked: false, draft: null, affected: null,
  current: { team_bits: 0, objects: {}, rule_sets: {}, holds_vault_key_gate: true },
};

const roles = [
  makeRole("r-admin", 0, { name: "admin", is_builtin: true, position: 1 }),
  makeRole("r-mem", 0, { name: "member", is_builtin: true, position: 2 }),
  makeRole("r-ed", 0, { name: "editor", position: 3 }),
];

beforeEach(() => {
  useTeamStore.setState({
    membersByTeam: { "team-1": [makeMember("admin", ["r-admin"]), makeMember("bob", ["r-mem"])] },
    rolesByTeam: { "team-1": roles },
    teams: [],
  });
  usePreviewStore.setState({ session: PREVIEW_SESSION, draft: null, result: PREVIEW_RESULT, saveFailures: [] });
});

afterEach(() => {
  cleanup();
  usePreviewStore.setState({ side: null, session: null, draft: null });
});

test("why_side_opens_the_sheet_with_why_panel", () => {
  showWhy();
  render(<MobileViewAsSheets />);
  const sheet = document.querySelector("[data-mobile-sheet]")!;
  expect(sheet.querySelector("[data-vt-hit-scope] [data-testid=why-panel]")).not.toBeNull();
});

test("closing_the_sheet_closes_the_side", async () => {
  showWhy();
  render(<MobileViewAsSheets />);
  fireScrimClick();
  await waitFor(() => expect(usePreviewStore.getState().side).toBeNull());
});

test("android_back_closes_the_why_sheet_first", async () => {
  showWhy();
  render(<MobileViewAsSheets />);
  let handled = false;
  act(() => { handled = runBack(); });
  expect(handled).toBe(true);
  await waitFor(() => expect(usePreviewStore.getState().side).toBeNull());
});

test("access_side_opens_member_access_panel_for_a_member", () => {
  usePreviewStore.setState({ side: { kind: "access" } });
  render(<MobileViewAsSheets />);
  const sheet = document.querySelector("[data-mobile-sheet]")!;
  expect(sheet.querySelector("[data-vt-hit-scope] [data-testid=member-access-panel]")).not.toBeNull();
  expect(sheet.textContent).toContain("members.viewAs.access.title");
});

test("access_side_opens_role_access_panel_for_a_role", () => {
  usePreviewStore.setState({
    side: { kind: "access" },
    session: { teamId: "team-1", vaultId: "team-1", subject: { type: "role", role_id: "r-ed" } },
  });
  render(<MobileViewAsSheets />);
  const sheet = document.querySelector("[data-mobile-sheet]")!;
  expect(sheet.querySelector("[data-vt-hit-scope] [data-testid=role-access-panel]")).not.toBeNull();
  expect(sheet.querySelector("[data-testid=member-access-panel]")).toBeNull();
});

test("role_chip_toggle_in_the_sheet_sets_a_draft", () => {
  usePreviewStore.setState({ side: { kind: "access" } });
  render(<MobileViewAsSheets />);
  fireEvent.click(screen.getByRole("button", { name: /editor/ }));
  expect(usePreviewStore.getState().draft).toEqual({ role_ids: ["r-mem", "r-ed"], allow: 0, deny: 0 });
});

function fireScrimClick() {
  act(() => { (document.querySelector("[data-mobile-sheet-scrim]") as HTMLElement).click(); });
}
