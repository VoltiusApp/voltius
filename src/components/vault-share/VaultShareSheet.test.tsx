import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  vault: { id: "v1", name: "Personal", teamId: null as string | null },
  members: [] as unknown[],
  roles: [] as unknown[],
  pending: [] as unknown[],
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("./PeopleList", () => ({ PeopleList: ({ people }: { people: unknown[] }) => <div>{`people:${people.length}`}</div> }));
vi.mock("./InviteControl", () => ({ InviteControl: () => <div>invite-control</div> }));
vi.mock("./ConvertToTeamGate", () => ({ ConvertToTeamGate: () => <div>convert-gate</div> }));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: Object.assign((sel: (s: unknown) => unknown) => sel({ vaults: [h.vault] }), {
    getState: () => ({ vaults: [h.vault] }),
  }),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: Object.assign(
    (sel: (s: unknown) => unknown) =>
      sel({
        membersByTeam: { t1: h.members },
        rolesByTeam: { t1: h.roles },
        pendingInvitationsByTeam: { t1: h.pending },
        loadMembers: vi.fn(), loadRoles: vi.fn(), loadPendingInvitations: vi.fn(),
      }),
    { getState: () => ({ loadMembers: vi.fn(), loadRoles: vi.fn(), loadPendingInvitations: vi.fn() }) },
  ),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: Object.assign((sel: (s: unknown) => unknown) => sel({ usedSeats: 1, totalSeats: 10, load: vi.fn() }), {
    getState: () => ({ load: vi.fn() }),
  }),
}));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: Object.assign((sel: (s: unknown) => unknown) => sel({ statusByTeamId: {} }), {
    getState: () => ({ statusByTeamId: {} }),
  }),
}));
vi.mock("@/services/teamService", () => ({ getMyUserId: vi.fn().mockResolvedValue(null) }));

import { VaultShareSheet } from "./VaultShareSheet";

afterEach(() => { cleanup(); h.vault.teamId = null; });

test("a private vault shows the conversion gate instead of the tabs", () => {
  render(<VaultShareSheet vaultId="v1" variant="full" />);
  expect(screen.getByText("convert-gate")).toBeTruthy();
  expect(screen.queryByText("invite-control")).toBeNull();
});

test("a team vault shows the tabs, People first", () => {
  h.vault.teamId = "t1";
  render(<VaultShareSheet vaultId="v1" variant="full" />);
  expect(screen.getByText("people:0")).toBeTruthy();
  expect(screen.queryByText("convert-gate")).toBeNull();
});

test("switching to Invite renders the invite control", () => {
  h.vault.teamId = "t1";
  render(<VaultShareSheet vaultId="v1" variant="full" />);
  fireEvent.click(screen.getByText("members.share.tabInvite"));
  expect(screen.getByText("invite-control")).toBeTruthy();
});
