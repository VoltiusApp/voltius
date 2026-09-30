import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("./MobileRemoteDeviceSessions", () => ({ default: () => null }));
vi.mock("./MobileHeader", () => ({ default: () => null }));
vi.mock("@/services/teamDataManager", () => ({ onVaultSelect: vi.fn(async () => {}) }));
vi.mock("@/services/teamService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamService")>()),
  getMyUserId: async () => "me",
}));
vi.mock("@/hooks/useRuleTunnels", () => ({
  useRuleTunnels: () => ({ statusFor: () => ({ status: "idle", statusLabel: "", isBusy: false }), startRule: vi.fn(), stopRule: vi.fn() }),
}));

import MobileHostsScreen from "./screens/MobileHostsScreen";
import MobileKeychainScreen from "./screens/MobileKeychainScreen";
import MobilePortForwardingScreen from "./screens/MobilePortForwardingScreen";
import MobileSnippetList from "./MobileSnippetList";
import VaultSwitcherSheet from "./sheets/VaultSwitcherSheet";
import { onVaultSelect } from "@/services/teamDataManager";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useFolderStore } from "@/stores/folderStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { initialMobileNavState } from "@/stores/mobileNavCore";

const TEAM = { id: "t1", name: "Ops", owner_id: "u", owner_tier: "team", created_at: "", role_ids: [] };
const PERSONAL = { id: "personal", name: "Personal" };
const LINKED = { id: "local-v2", name: "Vault 2", teamId: "t1" };

beforeEach(() => {
  useTeamStore.setState({ teams: [TEAM] as never, membersByTeam: { t1: [] }, rolesByTeam: { t1: [] } });
  useVaultStore.setState({ vaults: [PERSONAL, LINKED], selectedVaultIds: ["local-v2"] });
  useConnectionStore.setState({ connections: [], teamConnections: {} });
  useKeyStore.setState({ keys: [], teamKeys: {} });
  useIdentityStore.setState({ identities: [], teamIdentities: {} });
  usePortForwardingStore.setState({ rules: [], teamRules: {} });
  useSnippetStore.setState({ snippets: [], teamSnippets: {} });
  useFolderStore.setState({ folders: [], teamFolders: {} });
  useMobileNavStore.setState({ ...initialMobileNavState, hostSearch: "" });
});
afterEach(cleanup);

test("a converted team vault lists the hosts filed under its team id", () => {
  useConnectionStore.setState({
    teamConnections: { t1: [{ id: "c1", host: "h", port: 22, username: "u", vault_id: "t1", tags: [] }] as never },
  });
  const { container } = render(<MobileHostsScreen />);
  expect(container.querySelector('[data-mobile-host="c1"]')).not.toBeNull();
});

test("the keychain shows only the selected vault's keys and identities", () => {
  useVaultStore.setState({ selectedVaultIds: ["personal"] });
  useKeyStore.setState({
    keys: [{ id: "k-mine", name: "mine", tags: [], created_at: "2026-01-01T00:00:00Z", vault_id: "personal" }] as never,
    teamKeys: { t1: [{ id: "k-team", name: "team", tags: [], created_at: "2026-01-01T00:00:00Z", vault_id: "t1" }] as never },
  });
  useIdentityStore.setState({
    teamIdentities: { t1: [{ id: "i-team", username: "root", tags: [], vault_id: "t1" }] as never },
  });
  const { container } = render(<MobileKeychainScreen />);
  expect(container.querySelectorAll("[data-keychain-key]")).toHaveLength(1);
  expect(container.querySelectorAll("[data-keychain-identity]")).toHaveLength(0);
});

test("port forwarding shows only the selected vault's rules", () => {
  useVaultStore.setState({ selectedVaultIds: ["personal"] });
  const rule = (id: string, vault_id: string) => ({
    id, name: id, local_port: 1, remote_port: 2, remote_host: "h", tunnel_type: "local", connection_ids: [], vault_id,
  });
  usePortForwardingStore.setState({ rules: [rule("r-mine", "personal")] as never, teamRules: { t1: [rule("r-team", "t1")] as never } });
  const { container } = render(<MobilePortForwardingScreen />);
  expect(container.querySelectorAll("[data-pf-rule]")).toHaveLength(1);
});

test("team snippets are listed for their vault", () => {
  useSnippetStore.setState({
    teamSnippets: { t1: [{ id: "s1", name: "deploy", steps: [{ kind: "script", content: "ls" }], tags: [], vault_id: "t1" }] as never },
  });
  const { container } = render(<MobileSnippetList />);
  expect(container.querySelector('[data-mobile-snippet="s1"]')).not.toBeNull();
});

test("a folder created in a converted team vault is filed under the team, where teammates see it", async () => {
  useTeamStore.setState({
    membersByTeam: { t1: [{ user_id: "me", role_ids: ["editor"] }] as never },
    rolesByTeam: { t1: [{ id: "editor", name: "editor", permissions: 0x3ffff, is_builtin: true }] as never },
  });
  const saveFolder = vi.fn(async () => ({ id: "f1" }));
  useFolderStore.setState({ saveFolder } as never);
  render(<MobileKeychainScreen />);
  await act(async () => {});

  fireEvent.click(document.querySelector("[data-keychain-add]")!);
  fireEvent.click(document.querySelector('[data-add-choice="folder"]')!);
  fireEvent.change(document.querySelector("[data-folder-name-input]")!, { target: { value: "Prod" } });
  fireEvent.click(document.querySelector("[data-folder-name-save]")!);

  expect(saveFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "Prod", vault_id: "t1" }));
});

test("a read-only member gets no add button instead of one that files into Personal", async () => {
  useTeamStore.setState({
    membersByTeam: { t1: [{ user_id: "me", role_ids: ["viewer"] }] as never },
    rolesByTeam: { t1: [{ id: "viewer", name: "viewer", permissions: 1 << 17, is_builtin: true }] as never },
  });
  render(<MobileKeychainScreen />);
  await act(async () => {});
  expect(document.querySelector("[data-keychain-add]")).toBeNull();
});

test("switching to a team vault loads its data, as the desktop rail does", () => {
  render(<VaultSwitcherSheet />);
  fireEvent.click(document.querySelector('[data-vault-entry="local-v2"]')!);
  expect(useVaultStore.getState().selectedVaultIds).toEqual(["local-v2"]);
  expect(onVaultSelect).toHaveBeenCalledWith("t1");
});
