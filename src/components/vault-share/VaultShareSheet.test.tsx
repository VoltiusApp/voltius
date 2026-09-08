import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  vault: { id: "v1", name: "Personal", teamId: null as string | null },
  members: [] as unknown[],
  roles: [] as unknown[],
  pending: [] as unknown[],
  removeTeamMember: vi.fn().mockResolvedValue(undefined),
  revokeInvitation: vi.fn().mockResolvedValue(undefined),
  grantVaultKeyToMember: vi.fn().mockResolvedValue(undefined),
  writeClipboard: vi.fn().mockResolvedValue(undefined),
  keyHolders: [] as string[],
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
// A button per handler, so a no-op handler fails rather than passes.
vi.mock("./PeopleList", () => ({
  PeopleList: ({
    people,
    onRemove,
    onRevoke,
    onGrantKey,
    onCopyInviteLink,
  }: {
    people: { userId: string; handle: string; invitationId?: string; state: string }[];
    onRemove: (p: unknown) => void;
    onRevoke: (p: unknown) => void;
    onGrantKey: (p: unknown) => void;
    onCopyInviteLink: (p: unknown) => void;
  }) => (
    <div>
      <span>{`people:${people.length}`}</span>
      {people.map((p) => (
        <div key={p.userId}>
          {p.state === "awaiting_key" && <span>{`waiting:${p.userId}`}</span>}
          <button onClick={() => onRemove(p)}>{`remove:${p.userId}`}</button>
          <button onClick={() => onRevoke(p)}>{`revoke:${p.userId}`}</button>
          <button onClick={() => onGrantKey(p)}>{`grant:${p.userId}`}</button>
          <button onClick={() => onCopyInviteLink(p)}>{`link:${p.userId}`}</button>
        </div>
      ))}
    </div>
  ),
}));
vi.mock("./JoinLinksTab", () => ({ JoinLinksTab: () => <div>join-links</div> }));
vi.mock("@/services/vaultShare", () => ({
  removeTeamMember: h.removeTeamMember,
  revokeInvitation: h.revokeInvitation,
  grantVaultKeyToMember: h.grantVaultKeyToMember,
  addressedInviteLink: (id: string) => `voltius://notification?n=invite%3A${id}`,
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));
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
  useSubscriptionStore: Object.assign((sel: (s: unknown) => unknown) => sel({ usedSeats: 1, effectiveSeats: 10, load: vi.fn() }), {
    getState: () => ({ load: vi.fn() }),
  }),
}));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: Object.assign((sel: (s: unknown) => unknown) => sel({ statusByTeamId: {} }), {
    getState: () => ({ statusByTeamId: {} }),
  }),
}));
vi.mock("@/services/teamService", () => ({
  getMyUserId: vi.fn().mockResolvedValue(null),
  getVaultKeyHolders: () => Promise.resolve(h.keyHolders),
}));

import { VaultShareSheet } from "./VaultShareSheet";

afterEach(() => {
  cleanup();
  h.vault.teamId = null;
  h.members = [];
  h.pending = [];
  h.keyHolders = [];
  vi.clearAllMocks();
});

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

test("switching to Links renders the join-links tab", () => {
  h.vault.teamId = "t1";
  render(<VaultShareSheet vaultId="v1" variant="full" />);
  fireEvent.click(screen.getByText("members.share.tabLinks"));
  expect(screen.getByText("join-links")).toBeTruthy();
});

test("Remove and Grant now run the real calls, not a no-op", () => {
  h.vault.teamId = "t1";
  h.members = [{ user_id: "u1", handle: "bob", role_ids: [], public_key: "pk-bob" }];
  render(<VaultShareSheet vaultId="v1" variant="full" />);

  fireEvent.click(screen.getByText("remove:u1"));
  expect(h.removeTeamMember).toHaveBeenCalledWith({ teamId: "t1", userId: "u1", handle: "bob" });

  fireEvent.click(screen.getByText("grant:u1"));
  expect(h.grantVaultKeyToMember).toHaveBeenCalledWith({
    teamId: "t1",
    userId: "u1",
    handle: "bob",
    publicKey: "pk-bob",
  });
});

test("Revoke runs against the invitation id, and does nothing without one", () => {
  h.vault.teamId = "t1";
  h.members = [{ user_id: "u1", handle: "bob", role_ids: [], public_key: "pk" }];
  h.pending = [{ id: "inv1", display_name: "carol@example.com", role: "member" }];
  render(<VaultShareSheet vaultId="v1" variant="full" />);

  fireEvent.click(screen.getByText("revoke:inv1"));
  expect(h.revokeInvitation).toHaveBeenCalledWith({
    teamId: "t1",
    invitationId: "inv1",
    name: "carol@example.com",
  });

  fireEvent.click(screen.getByText("revoke:u1"));
  expect(h.revokeInvitation).toHaveBeenCalledTimes(1);
});

test("only members missing from the key-holder list read as waiting", async () => {
  h.vault.teamId = "t1";
  h.members = [
    { user_id: "u1", handle: "bob", role_ids: [], public_key: "pk1" },
    { user_id: "u2", handle: "carol", role_ids: [], public_key: "pk2" },
  ];
  h.keyHolders = ["u1"];
  render(<VaultShareSheet vaultId="v1" variant="full" />);
  await waitFor(() => expect(screen.getByText("waiting:u2")).toBeTruthy());
  expect(screen.queryByText("waiting:u1")).toBeNull();
});

test("nobody reads as waiting while the key-holder list is unknown", () => {
  h.vault.teamId = "t1";
  h.members = [{ user_id: "u1", handle: "bob", role_ids: [], public_key: "pk1" }];
  render(<VaultShareSheet vaultId="v1" variant="full" />);
  expect(screen.queryByText("waiting:u1")).toBeNull();
});

test("the addressed invite link is copied for a pending invitation only", () => {
  h.vault.teamId = "t1";
  h.members = [{ user_id: "u1", handle: "bob", role_ids: [], public_key: "pk" }];
  h.pending = [{ id: "inv1", display_name: "carol@example.com", role: "member" }];
  render(<VaultShareSheet vaultId="v1" variant="full" />);

  fireEvent.click(screen.getByText("link:u1"));
  expect(h.writeClipboard).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("link:inv1"));
  expect(h.writeClipboard).toHaveBeenCalledWith("voltius://notification?n=invite%3Ainv1");
});
