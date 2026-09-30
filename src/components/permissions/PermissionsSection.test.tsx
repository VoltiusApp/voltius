import { test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { PermissionsSection } from "./PermissionsSection";
import { saveObjectRules, syncWithFolder } from "@/services/ruleSetEditing";
import { getRuleSet } from "@/services/teamObjects";
import { ALL_PERMISSION_BITS, PERM_BITS } from "@/services/permissions";
import { useTeamObjectAccessStore, type ObjectAccess } from "@/stores/teamObjectAccessStore";

const h = vi.hoisted(() => ({
  roles: [] as { id: string; name: string; permissions: number }[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { folder?: string; roles?: string; count?: number }) => {
      const v = o?.folder ?? o?.roles ?? o?.count;
      return v === undefined ? k : `${k} ${v}`;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/ruleSetEditing", () => ({ saveObjectRules: vi.fn(), syncWithFolder: vi.fn() }));
vi.mock("@/services/teamObjects", () => ({ getRuleSet: vi.fn() }));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (sel: (s: object) => unknown) => sel({
    teams: [{ id: "t1" }],
    rolesByTeam: { t1: h.roles },
    membersByTeam: { t1: [{ user_id: "u2", handle: "bob", role_ids: [] }] },
  }),
}));
vi.mock("@/stores/folderStore", () => ({
  useFolderStore: (sel: (s: object) => unknown) => sel({ teamFolders: { t1: [{ id: "fA", name: "Prod" }] } }),
}));
vi.mock("@/stores/snippetFolderStore", () => ({
  useSnippetFolderStore: (sel: (s: object) => unknown) => sel({ teamSnippetFolders: {} }),
}));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: (sel: (s: object) => unknown) => sel({ vaults: [{ id: "v-local", name: "Team", teamId: "t1" }] }),
}));

const seed = (over: Partial<ObjectAccess> = {}) => useTeamObjectAccessStore.getState().replaceTeam("t1", {
  fA: { type: "folder", ruleSetId: "sA", myPermissions: ALL_PERMISSION_BITS, parentId: null, deleted: false },
  c1: { type: "connection", ruleSetId: "sA", myPermissions: ALL_PERMISSION_BITS, parentId: "fA", deleted: false, ...over },
}, true);

const connectRow = () => screen.findByRole("radiogroup", { name: "members.permission.CONNECT" });

beforeEach(() => {
  h.roles = [{ id: "r1", name: "sysadmin", permissions: PERM_BITS.CONNECT }];
  vi.mocked(getRuleSet).mockResolvedValue([]);
  vi.mocked(saveObjectRules).mockResolvedValue();
  vi.mocked(syncWithFolder).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useTeamObjectAccessStore.getState().clearAll();
});

test("hidden without Manage permissions", () => {
  seed({ myPermissions: PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS });
  const { container } = render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(container.innerHTML).toBe("");
});

test("hidden against a server without my_permissions", () => {
  useTeamObjectAccessStore.getState().clearTeam("t1");
  const { container } = render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(container.innerHTML).toBe("");
});

test("a synced host names its folder and saves an @everyone deny", async () => {
  seed();
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(await screen.findByText("shared.permissions.section.syncedWith Prod")).toBeTruthy();
  const connect = await connectRow();
  fireEvent.click(within(connect).getByRole("radio", { name: "members.permissions.state.deny" }));
  await waitFor(() => expect(saveObjectRules).toHaveBeenCalledWith(
    { teamId: "t1", objectId: "c1", type: "connection" },
    [{ subject_type: "everyone", subject_id: null, allow: 0, deny: PERM_BITS.CONNECT }],
  ));
});

test("keys say Use for Connect", async () => {
  seed({ type: "key" });
  render(<PermissionsSection objectId="c1" vaultId="t1" type="key" />);
  expect(await screen.findByText("shared.permissions.section.titleKey")).toBeTruthy();
  expect(screen.getByRole("radiogroup", { name: "shared.permissions.section.use" })).toBeTruthy();
});

test("a failed save puts the toggle back and shows the error", async () => {
  seed();
  vi.mocked(saveObjectRules).mockRejectedValue(new Error("boom"));
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  const connect = await connectRow();
  fireEvent.click(within(connect).getByRole("radio", { name: "members.permissions.state.deny" }));
  await waitFor(() => expect(within(connect).getByRole("radio", { name: "members.permissions.state.inherit" }).getAttribute("aria-checked")).toBe("true"));
  expect(await screen.findByText("boom")).toBeTruthy();
});

test("Sync now on an un-synced host", async () => {
  seed({ ruleSetId: "sOwn" });
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(await screen.findByText("shared.permissions.section.notSynced")).toBeTruthy();
  fireEvent.click(screen.getByText("shared.permissions.section.syncNow"));
  expect(syncWithFolder).toHaveBeenCalledWith({ teamId: "t1", objectId: "c1", type: "connection" });
});

test("an object with its own set at the root offers the team's permissions", async () => {
  seed({ parentId: null, ruleSetId: "sOwn" });
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(await screen.findByText("shared.permissions.section.ownPermissions")).toBeTruthy();
  fireEvent.click(screen.getByText("shared.permissions.section.useTeams"));
  expect(syncWithFolder).toHaveBeenCalledWith({ teamId: "t1", objectId: "c1", type: "connection" });
});

test("a synced root object uses the team's permissions", async () => {
  seed({ parentId: null, ruleSetId: null });
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(await screen.findByText("shared.permissions.section.syncedTeam")).toBeTruthy();
  expect(screen.queryByText("shared.permissions.section.syncNow")).toBeNull();
});

test("subject chips are outlined like the toggle", async () => {
  seed();
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  const chip = await screen.findByRole("button", { name: "shared.permissions.everyone" });
  expect(chip.className).toContain("bg-(--t-bg-base)");
  expect(chip.className).toContain("border-(--t-border-hover)");
});

test("a granting role is named, more than two are counted", async () => {
  seed();
  const { unmount } = render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect((await connectRow()).parentElement!.textContent).toContain("members.permissions.inheritedFrom sysadmin");
  unmount();
  h.roles = ["a", "b", "c"].map((n) => ({ id: n, name: n, permissions: PERM_BITS.CONNECT }));
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect((await connectRow()).parentElement!.textContent).toContain("members.permissions.inheritedFrom shared.permissions.section.roleCount 3");
});

test("a member added from the picker gets their own rule", async () => {
  seed();
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  fireEvent.click(await screen.findByText("shared.permissions.section.addSubject"));
  fireEvent.click(await screen.findByText("@bob"));
  fireEvent.click(within(await connectRow()).getByRole("radio", { name: "members.permissions.state.allow" }));
  await waitFor(() => expect(saveObjectRules).toHaveBeenCalledWith(
    { teamId: "t1", objectId: "c1", type: "connection" },
    [{ subject_type: "member", subject_id: "u2", allow: PERM_BITS.CONNECT, deny: 0 }],
  ));
});

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const radio = async (permission: string, state: string) =>
  within(await screen.findByRole("radiogroup", { name: `members.permission.${permission}` }))
    .getByRole("radio", { name: `members.permissions.state.${state}` });
const checked = async (permission: string, state: string) => (await radio(permission, state)).getAttribute("aria-checked");

test("a failed save drops the saves queued behind it and shows what the server holds", async () => {
  seed();
  const first = deferred();
  vi.mocked(saveObjectRules).mockReturnValueOnce(first.promise);
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  await waitFor(async () => expect((await radio("CONNECT", "deny")).hasAttribute("disabled")).toBe(false));
  fireEvent.click(await radio("CONNECT", "deny"));
  fireEvent.click(await radio("VIEW", "deny"));
  first.reject(new Error("boom"));
  expect(await screen.findByText("boom")).toBeTruthy();
  await new Promise((r) => setTimeout(r, 0));
  expect(saveObjectRules).toHaveBeenCalledTimes(1);
  expect(await checked("CONNECT", "inherit")).toBe("true");
  expect(await checked("VIEW", "inherit")).toBe("true");
});

test("a failed save after a successful one falls back to the saved rules", async () => {
  seed({ ruleSetId: "sOwn" });
  vi.mocked(saveObjectRules).mockResolvedValueOnce().mockRejectedValueOnce(new Error("boom"));
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  await waitFor(async () => expect((await radio("CONNECT", "deny")).hasAttribute("disabled")).toBe(false));
  fireEvent.click(await radio("CONNECT", "deny"));
  fireEvent.click(await radio("VIEW", "deny"));
  expect(await screen.findByText("boom")).toBeTruthy();
  expect(await checked("CONNECT", "deny")).toBe("true");
  expect(await checked("VIEW", "inherit")).toBe("true");
});

test("a rule-set reload during queued saves keeps the newer draft", async () => {
  seed();
  const connectDeny = [{ subject_type: "everyone" as const, subject_id: null, allow: 0, deny: PERM_BITS.CONNECT }];
  vi.mocked(getRuleSet).mockImplementation(async (_team, setId) => (setId === "sNew" ? connectDeny : []));
  const first = deferred();
  const second = deferred();
  vi.mocked(saveObjectRules)
    .mockImplementationOnce(async () => {
      await first.promise;
      const c1 = useTeamObjectAccessStore.getState().byTeam.t1.c1;
      useTeamObjectAccessStore.getState().upsert("t1", "c1", { ...c1, ruleSetId: "sNew" });
    })
    .mockReturnValueOnce(second.promise);
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  await waitFor(async () => expect((await radio("CONNECT", "deny")).hasAttribute("disabled")).toBe(false));
  fireEvent.click(await radio("CONNECT", "deny"));
  fireEvent.click(await radio("VIEW", "deny"));
  first.resolve();
  await waitFor(() => expect(getRuleSet).toHaveBeenCalledWith("t1", "sNew"));
  await waitFor(async () => expect((await radio("VIEW", "deny")).hasAttribute("disabled")).toBe(false));
  expect(await checked("VIEW", "deny")).toBe("true");
  second.resolve();
  await waitFor(() => expect(saveObjectRules).toHaveBeenCalledTimes(2));
  expect(await checked("VIEW", "deny")).toBe("true");
  expect(await checked("CONNECT", "deny")).toBe("true");
});

test("switching to another object while a save is pending shows that object's own rules", async () => {
  useTeamObjectAccessStore.getState().replaceTeam("t1", {
    c1: { type: "connection", ruleSetId: "s1", myPermissions: ALL_PERMISSION_BITS, parentId: null, deleted: false },
    c2: { type: "connection", ruleSetId: "s2", myPermissions: ALL_PERMISSION_BITS, parentId: null, deleted: false },
  }, true);
  const viewDeny = [{ subject_type: "everyone" as const, subject_id: null, allow: 0, deny: PERM_BITS.VIEW }];
  vi.mocked(getRuleSet).mockImplementation(async (_team, setId) => (setId === "s2" ? viewDeny : []));
  vi.mocked(saveObjectRules).mockReturnValueOnce(deferred().promise);
  const { rerender } = render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  await waitFor(async () => expect((await radio("CONNECT", "deny")).hasAttribute("disabled")).toBe(false));
  fireEvent.click(await radio("CONNECT", "deny"));
  rerender(<PermissionsSection objectId="c2" vaultId="t1" type="connection" />);
  await waitFor(async () => expect(await checked("VIEW", "deny")).toBe("true"));
  expect(await checked("CONNECT", "inherit")).toBe("true");
});

test("a failed load shows the server's error, never empty brackets", async () => {
  seed();
  vi.mocked(getRuleSet).mockRejectedValue(new Error("Could not load permissions (500)"));
  const { unmount } = render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(await screen.findByText("Could not load permissions (500)")).toBeTruthy();
  unmount();
  vi.mocked(getRuleSet).mockRejectedValue("offline");
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  expect(await screen.findByText("shared.permissions.section.loadFailed")).toBeTruthy();
});

test("denying Connect locks View secrets and Copy secrets, which depend on it", async () => {
  seed();
  render(<PermissionsSection objectId="c1" vaultId="t1" type="connection" />);
  const viewSecrets = await screen.findByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  expect(within(viewSecrets).getByRole("radio", { name: "members.permissions.state.allow" }).hasAttribute("disabled")).toBe(false);

  fireEvent.click(within(await connectRow()).getByRole("radio", { name: "members.permissions.state.deny" }));

  await waitFor(() => expect(within(viewSecrets).getByRole("radio", { name: "members.permissions.state.allow" }).hasAttribute("disabled")).toBe(true));
  const copySecrets = screen.getByRole("radiogroup", { name: "members.permission.COPY_SECRETS" });
  expect(within(copySecrets).getByRole("radio", { name: "members.permissions.state.allow" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getAllByText("shared.permissions.section.requiresConnect")).toHaveLength(2);
});
