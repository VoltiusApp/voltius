import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

import { MembersToolbar } from "./MembersToolbar";

afterEach(cleanup);

test("greyed Security, Roles and Invite carry the shared disabled styling", () => {
  render(
    <MembersToolbar
      search="" onSearchChange={() => {}} layoutMode="list" onLayoutModeChange={() => {}} sortMode="name-asc" onSortModeChange={() => {}}
      canInvite={false} canManageRoles={false} canManageVault={false} activePanel={null} onTogglePanel={() => {}}
      selectedCount={0} primaryVaultId={null} onSelectVault={() => {}}
    />,
  );
  for (const label of ["members.security.button", "members.roles", "members.toolbar.inviteBtn"]) {
    const button = screen.getByText(label).closest("button")!;
    expect(button.disabled, label).toBe(true);
    expect(button.className, label).toContain("disabled:opacity-50");
  }
});
