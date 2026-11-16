import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, fireEvent, type RenderResult } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("../MobileRemoteDeviceSessions", () => ({ default: () => null }));
vi.mock("../MobileHeader", () => ({ MobileLargeTopBar: () => null, MobileLargeTitle: () => null, APPBAR_TONAL: "" }));
vi.mock("../MobileActiveTunnels", () => ({ default: () => null }));
vi.mock("@/hooks/useRuleTunnels", () => ({
  useRuleTunnels: () => ({ statusFor: () => ({ status: "idle", statusLabel: "", isBusy: false }), startRule: vi.fn(), stopRule: vi.fn() }),
}));

import MobileHostsScreen from "./MobileHostsScreen";
import MobileKeychainScreen from "./MobileKeychainScreen";
import MobilePortForwardingScreen from "./MobilePortForwardingScreen";
import MobileSnippetList from "../MobileSnippetList";
import { PreviewContentScope } from "@/components/preview/PreviewScope";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { initialMobileNavState } from "@/stores/mobileNavCore";
import { PERM_BITS } from "@/services/permissions";
import { startPreview, stopPreview } from "@/test/preview";

const folder = (id: string, object_type: string) => ({ id, name: id, object_type, vault_id: "t1", created_at: "", updated_at: "", clocks: {} });

const preview = (masks: Record<string, number>) => ({
  locked: false,
  current: {
    team_bits: 0,
    objects: Object.fromEntries(Object.entries(masks).map(([k, mask]) => [k, { mask, rule_set_id: null }])),
    rule_sets: {},
    holds_vault_key_gate: true,
  },
  draft: null,
  affected: null,
});

const VISIBLE = PERM_BITS.VIEW;

beforeEach(() => {
  useTeamStore.setState({
    teams: [{ id: "t1", name: "Ops", owner_id: "u", owner_tier: "team", created_at: "", role_ids: [] }] as never,
    membersByTeam: { t1: [] },
    rolesByTeam: { t1: [] },
  });
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }, { id: "local-v2", name: "Vault 2", teamId: "t1" }], selectedVaultIds: ["local-v2"] });
  useConnectionStore.setState({
    connections: [],
    teamConnections: { t1: [
      { id: "h-hidden", name: "secret-host", host: "a", port: 22, username: "u", vault_id: "t1", tags: [] },
      { id: "h-ok", name: "open-host", host: "b", port: 22, username: "u", vault_id: "t1", tags: [] },
    ] as never },
  });
  useKeyStore.setState({
    keys: [],
    teamKeys: { t1: [
      { id: "k-hidden", name: "secret-key", tags: [], created_at: "2026-01-01T00:00:00Z", vault_id: "t1" },
      { id: "k-ok", name: "open-key", tags: [], created_at: "2026-01-01T00:00:00Z", vault_id: "t1" },
    ] as never },
  });
  useIdentityStore.setState({ identities: [], teamIdentities: {} });
  const rule = (id: string) => ({ id, name: id, local_port: 1, remote_port: 2, remote_host: "h", tunnel_type: "local", connection_ids: [], vault_id: "t1" });
  usePortForwardingStore.setState({ rules: [], teamRules: { t1: [rule("r-hidden"), rule("r-ok")] as never } });
  const snippet = (id: string) => ({ id, name: id, steps: [{ kind: "script", content: "ls" }], tags: [], vault_id: "t1" });
  useSnippetStore.setState({ snippets: [], teamSnippets: { t1: [snippet("s-hidden"), snippet("s-ok")] as never } });
  useFolderStore.setState({
    folders: [],
    teamFolders: { t1: [folder("f-hidden-conn", "connection"), folder("f-hidden-kc", "keychain"), folder("f-hidden-pf", "port_forwarding")] as never },
  });
  useSnippetFolderStore.setState({ folders: [], teamSnippetFolders: { t1: [folder("f-hidden-sn", "snippet")] as never } });
  useMobileNavStore.setState({ ...initialMobileNavState, hostSearch: "" });
  startPreview();
  usePreviewStore.setState({
    result: preview({
      "h-hidden": 0, "h-ok": VISIBLE, "k-hidden": 0, "k-ok": VISIBLE, "r-hidden": 0, "r-ok": VISIBLE, "s-hidden": 0, "s-ok": VISIBLE,
      "f-hidden-conn": 0, "f-hidden-kc": 0, "f-hidden-pf": 0, "f-hidden-sn": 0,
    }),
  });
});
afterEach(() => {
  cleanup();
  stopPreview();
});

const inScope = (el: React.ReactElement) => render(<PreviewContentScope>{el}</PreviewContentScope>);

async function expectGhostOpensWhy(view: RenderResult, name: string, type: string, id: string) {
  await act(async () => {});
  const ghosts = [...view.container.querySelectorAll("[data-ghost-card]")];
  const ghost = ghosts.find((g) => g.textContent?.includes(name));
  expect(ghost, name).toBeTruthy();
  expect(ghost!.textContent).toContain("members.viewAs.hiddenFrom");
  fireEvent.click(ghost!);
  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type, objectId: id });
}

test("hidden_host_is_a_ghost_and_opens_why", async () => {
  const view = inScope(<MobileHostsScreen />);
  await expectGhostOpensWhy(view, "secret-host", "connection", "h-hidden");
  expect(view.container.querySelector('[data-mobile-host="h-hidden"]')).toBeNull();
  expect(view.container.querySelector('[data-mobile-host="h-ok"]')).not.toBeNull();
});

test("hidden_key_is_a_ghost_and_opens_why", async () => {
  const view = inScope(<MobileKeychainScreen />);
  await expectGhostOpensWhy(view, "secret-key", "key", "k-hidden");
  expect(view.container.querySelectorAll("[data-keychain-key]")).toHaveLength(1);
});

test("hidden_snippet_is_a_ghost_and_opens_why", async () => {
  const view = inScope(<MobileSnippetList />);
  await expectGhostOpensWhy(view, "s-hidden", "snippet", "s-hidden");
  expect(view.container.querySelector('[data-mobile-snippet="s-hidden"]')).toBeNull();
});

test("hidden_rule_is_a_ghost_and_opens_why", async () => {
  const view = inScope(<MobilePortForwardingScreen />);
  await expectGhostOpensWhy(view, "r-hidden", "port_forwarding_rule", "r-hidden");
  expect(view.container.querySelectorAll("[data-pf-rule]")).toHaveLength(1);
});

test("keychain_ghosts_name_and_icon_like_their_rows", async () => {
  useKeyStore.setState({ teamKeys: { t1: [{ id: "k-noname", tags: [], created_at: "2026-01-01T00:00:00Z", vault_id: "t1" }] as never } });
  useIdentityStore.setState({ teamIdentities: { t1: [{ id: "i-hidden", username: "deploy", tags: [], vault_id: "t1" }] as never } });
  usePreviewStore.setState({ result: preview({ "k-noname": 0, "i-hidden": 0 }) });
  const view = inScope(<MobileKeychainScreen />);
  await act(async () => {});
  const [keyGhost, identityGhost] = view.container.querySelectorAll("[data-ghost-card]");
  expect(keyGhost.textContent).toContain("mobile.sheets.keychainActions.unnamedKey");
  expect(keyGhost.querySelector('[data-icon="lucide:key-round"]')).not.toBeNull();
  expect(identityGhost.textContent).toContain("deploy");
  expect(identityGhost.querySelector('[data-icon="lucide:user"]')).not.toBeNull();
});

test.each([
  ["hosts", () => <MobileHostsScreen />, "f-hidden-conn", "folder"],
  ["keychain", () => <MobileKeychainScreen />, "f-hidden-kc", "folder"],
  ["port forwarding", () => <MobilePortForwardingScreen />, "f-hidden-pf", "folder"],
  ["snippets", () => <MobileSnippetList />, "f-hidden-sn", "snippet_folder"],
])("hidden_folder_is_a_ghost_and_opens_why (%s)", async (_n, screen, id, type) => {
  const view = inScope(screen());
  await expectGhostOpensWhy(view, id, type, id);
  expect(view.container.querySelector("[data-mobile-folder]")).toBeNull();
});

test("visible_row_subtitle_shows_the_preview_hint", async () => {
  const view = inScope(<MobileHostsScreen />);
  await act(async () => {});
  const row = view.container.querySelector('[data-mobile-host="h-ok"]')!;
  expect(row.textContent).toContain("members.viewAs.level.");
  expect(row.textContent).not.toContain("u@b");
});

test("outside_a_preview_rows_are_unchanged", async () => {
  stopPreview();
  const view = render(<MobileHostsScreen />);
  await act(async () => {});
  expect(view.container.querySelectorAll("[data-ghost-card]")).toHaveLength(0);
  const row = view.container.querySelector('[data-mobile-host="h-ok"]')!;
  expect(row.textContent).toContain("u@b");
  expect(row.textContent).not.toContain("members.viewAs");
});
