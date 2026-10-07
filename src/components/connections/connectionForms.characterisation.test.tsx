import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import type { Connection } from "@/types";

function conn(over: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    host: "h.example",
    port: 22,
    username: "root",
    auth_type: "password",
    tags: [],
    vault_id: "personal",
    created_at: "",
    updated_at: "",
    clocks: {},
    ...over,
  } as Connection;
}

const h = vi.hoisted(() => ({
  folders: [] as unknown[],
  teamFolders: {} as Record<string, unknown[]>,
  saveFolder: vi.fn(async (input: unknown) => ({ id: "f-new", ...(input as object) })),
  loadFolders: vi.fn(async () => {}),
  pinConnection: vi.fn(async (_id: string, _pinned: boolean) => {}),
  setDistro: vi.fn(async () => {}),
  teams: [] as { id: string }[],
  effectivePinned: false,
  pinSource: "team" as string,
  nextPersonalPinValue: vi.fn((_source: string) => true),
  serialListPorts: vi.fn(async () => [{ name: "ttyUSB0", path: "/dev/ttyUSB0" }]),
  defaultVaultId: "personal",
}));

// A team connection the caller holds no role in, so the forms open it read-only.
function lockedConn(over: Partial<Connection> = {}): Connection {
  h.teams = [{ id: "team-1" }];
  return conn({ vault_id: "team-1", ...over });
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

vi.mock("@/stores/folderStore", () => ({
  useFolderStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const state = { folders: h.folders, teamFolders: h.teamFolders, loadFolders: h.loadFolders, saveFolder: h.saveFolder };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ folders: h.folders, teamFolders: h.teamFolders, loadFolders: h.loadFolders, saveFolder: h.saveFolder }) },
  ),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel?: (s: unknown) => unknown) => {
    const state = { pinConnection: h.pinConnection, setDistro: h.setDistro };
    return sel ? sel(state) : state;
  },
  findAnyConnection: () => undefined,
}));
vi.mock("@/stores/teamStore", () => ({
  // The forms resolve VIEW_SECRETS through `usePermissions`, which reads the
  // roster and loader actions as well as the team list.
  useTeamStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const state = {
        teams: h.teams,
        membersByTeam: {},
        rolesByTeam: {},
        loadTeams: async () => {},
        loadMembers: async () => {},
        loadRoles: async () => {},
      };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ teams: h.teams, membersByTeam: {}, rolesByTeam: {} }) },
  ),
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: () => ({ identities: [], teamIdentities: [], loadIdentities: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/keyStore", () => ({
  useKeyStore: () => ({ keys: [], teamKeys: [], loadKeys: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: () => ({ toggleExcluded: vi.fn(), isObjectSynced: () => true }),
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: (sel?: (s: unknown) => unknown) => {
    const state = { setActiveNav: vi.fn() };
    return sel ? sel(state) : state;
  },
  findAnyConnection: () => undefined,
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ useToggle: () => [false, vi.fn()] }));
vi.mock("@/stores/connectivitySettingsStore", () => ({
  useGlobalKeepalivePreset: () => ["balanced", vi.fn()],
  useGlobalProxy: () => [{ mode: "none" }, vi.fn()],
  HOST_PROXY_MODES: ["direct", "system", "socks5", "http", "https"],
}));
vi.mock("@/stores/hostCommandVarsStore", () => ({ clearRememberedVars: vi.fn() }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("@/hooks/useConnectAsMenuItem", () => ({ useConnectAsMenuItem: () => undefined }));
vi.mock("@/hooks/useCredentialPlan", () => ({ useCredentialPlan: () => ({ plan: { kind: "host" } }), NO_CONNECTION: {} }));
vi.mock("@/hooks/useEffectivePinned", () => ({
  useEffectivePinned: () => h.effectivePinned,
  useEffectivePinSource: () => h.pinSource,
  nextPersonalPinValue: (s: string) => h.nextPersonalPinValue(s),
}));
vi.mock("@/hooks/useWritableVaultIds", () => ({
  useDefaultVaultId: () => h.defaultVaultId,
  resolveVaultIdForSave: (v: string) => v,
}));
vi.mock("@/services/vault", () => ({ getSecret: vi.fn(async () => null) }));
vi.mock("@/services/ssh", () => ({ sshExecCommand: vi.fn(async () => "ID=debian") }));
vi.mock("@/services/serial", () => ({ serialListPorts: () => h.serialListPorts() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: () => ({}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));

vi.mock("@/components/shared/TagSelector", () => ({
  default: ({ value, vaultId, onChange }: { value: string[]; vaultId: string; onChange: (v: string[]) => void }) => (
    <button data-tag-selector data-vault={vaultId} onClick={() => onChange([...value, "added"])}>
      {value.join(",")}
    </button>
  ),
}));
vi.mock("@/components/shared/FolderSelector", () => ({
  default: ({
    value,
    folders,
    onChange,
    onCreateFolder,
  }: {
    value: string | null;
    folders: { id: string }[];
    onChange: (id: string | null) => void;
    onCreateFolder: (name: string) => Promise<string>;
  }) => (
    <div data-folder-selector data-count={folders.length} data-value={value ?? ""}>
      <button data-folder-pick onClick={() => onChange("f1")} />
      <button data-folder-create onClick={() => void onCreateFolder("made")} />
    </div>
  ),
}));
vi.mock("@/components/shared/VaultPicker", () => ({
  VaultPicker: ({ vaultId, onChange }: { vaultId: string; onChange: (id: string) => void }) => (
    <button data-vault-picker data-value={vaultId} onClick={() => onChange("team-1")} />
  ),
}));
vi.mock("@/components/shared/PinButton", () => ({
  PinButton: ({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) => (
    <button data-pin data-pinned={String(pinned)} onClick={onToggle} />
  ),
}));
vi.mock("@/components/shared/PanelActionsMenu", () => ({
  PanelActionsMenu: ({ items }: { items: unknown[] }) => <div data-actions-menu data-count={items.length} />,
}));
vi.mock("./EncodingSelector", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <button data-encoding data-value={value} onClick={() => onChange("utf-8")} />
  ),
}));
vi.mock("./HostCommandField", () => ({
  HostCommandField: ({
    slot,
    text,
    snippetId,
    onChangeText,
    onChangeSnippetId,
  }: {
    slot: string;
    text: string;
    snippetId?: string;
    onChangeText: (v: string) => void;
    onChangeSnippetId: (v: string | undefined) => void;
  }) => (
    <div data-host-command={slot} data-text={text} data-snippet={snippetId ?? ""}>
      <button data-host-command-text={slot} onClick={() => onChangeText(`${slot}-cmd`)} />
      <button data-host-command-snippet={slot} onClick={() => onChangeSnippetId(`${slot}-snip`)} />
    </div>
  ),
}));
vi.mock("@/components/notes/NotesEditor", () => ({
  NotesEditor: ({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) => (
    <textarea data-notes value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("./DistroIconPicker", () => ({ DistroIconPicker: () => null }));
vi.mock("./IdentitySelector", () => ({ default: () => null }));
vi.mock("./KeySelector", () => ({ default: () => null }));
vi.mock("./JumpHostsPanel", () => ({ default: () => null }));
vi.mock("./EnvVarsPanel", () => ({ default: () => null }));

const { default: ConnectionForm } = await import("./ConnectionForm");
const { useTeamObjectAccessStore } = await import("@/stores/teamObjectAccessStore");
const { PERM_BITS } = await import("@/services/permissions");
const { default: SerialConnectionForm } = await import("./SerialConnectionForm");
const { RuleSetMoveCancelled } = await import("@/services/teamObjectPersistence");
type FormHandle = { flush: () => void; isDirty: () => boolean };

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  vi.useFakeTimers();
  h.folders = [
    { id: "f1", name: "One", object_type: "connection", vault_id: "personal" },
    { id: "s1", name: "Snip", object_type: "snippet", vault_id: "personal" },
  ];
  h.teamFolders = {
    "team-1": [
      { id: "t1", name: "Prod", object_type: "connection", vault_id: "team-1" },
      { id: "t2", name: "Staging", object_type: "connection", vault_id: "team-1" },
    ],
  };
  h.teams = [];
  h.effectivePinned = false;
  h.defaultVaultId = "personal";
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderSsh(props: Partial<Parameters<typeof ConnectionForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const ref = createRef<FormHandle>();
  render(
    <ConnectionForm ref={ref} onSubmit={onSubmit} onClose={vi.fn()} {...props} />,
  );
  return { onSubmit, ref };
}
function renderSerial(props: Partial<Parameters<typeof SerialConnectionForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const ref = createRef<FormHandle>();
  render(
    <SerialConnectionForm ref={ref} onSubmit={onSubmit} onClose={vi.fn()} {...props} />,
  );
  return { onSubmit, ref };
}

// ── shared general section: tags + folder ───────────────────────────────────

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form scopes the folder selector to connection folders and passes the vault to tags", (_kind, mount) => {
  mount();
  expect(document.querySelector("[data-folder-selector]")?.getAttribute("data-count")).toBe("1");
  expect(document.querySelector("[data-tag-selector]")?.getAttribute("data-vault")).toBe("personal");
});

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form creates a connection folder in the current vault and selects it", async (_kind, mount) => {
  mount();
  await act(async () => {
    fireEvent.click(document.querySelector("[data-folder-create]")!);
  });
  expect(h.saveFolder).toHaveBeenCalledWith({ name: "made", object_type: "connection", vault_id: "personal" });
  expect(document.querySelector("[data-folder-selector]")?.getAttribute("data-value")).toBe("f-new");
});

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form lists the team vault's folders and keeps the object's team folder", (_kind, mount) => {
  h.teams = [{ id: "team-1" }];
  mount({ initial: conn({ vault_id: "team-1", folder_id: "t2" }) });
  const selector = document.querySelector("[data-folder-selector]");
  expect(selector?.getAttribute("data-count")).toBe("2");
  expect(selector?.getAttribute("data-value")).toBe("t2");
});

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form clears the folder when the vault changes", (_kind, mount) => {
  h.teams = [{ id: "team-1" }];
  mount({ initial: conn({ folder_id: "f1" }) });
  fireEvent.click(document.querySelector("[data-vault-picker]")!);
  const selector = document.querySelector("[data-folder-selector]");
  expect(selector?.getAttribute("data-value")).toBe("");
  expect(selector?.getAttribute("data-count")).toBe("2");
});

// ── shared header: vault picker + pin ───────────────────────────────────────

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form pins a personal connection with the plain toggle", (_kind, mount) => {
  mount({ initial: conn() });
  fireEvent.click(document.querySelector("[data-pin]")!);
  expect(h.pinConnection).toHaveBeenCalledWith("c1", true);
});

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form pins a team connection through the personal override", (_kind, mount) => {
  h.teams = [{ id: "team-1" }];
  h.nextPersonalPinValue.mockReturnValue(false);
  mount({ initial: conn({ vault_id: "team-1" }) });
  fireEvent.click(document.querySelector("[data-pin]")!);
  expect(h.nextPersonalPinValue).toHaveBeenCalled();
  expect(h.pinConnection).toHaveBeenCalledWith("c1", false);
});

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form follows the default vault only until the picker is touched", (_kind, mount) => {
  mount();
  expect(document.querySelector("[data-vault-picker]")?.getAttribute("data-value")).toBe("personal");
  fireEvent.click(document.querySelector("[data-vault-picker]")!);
  expect(document.querySelector("[data-vault-picker]")?.getAttribute("data-value")).toBe("team-1");
});

// ── shared advanced disclosure + host commands ──────────────────────────────

test("ssh form hides the advanced block until toggled and submits its host commands", async () => {
  const { onSubmit, ref } = renderSsh();
  expect(document.querySelector('[data-host-command="pre"]')).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("connections.form.hostPlaceholder"), {
    target: { value: "srv" },
  });
  fireEvent.click(document.querySelector('[data-host-command-text="pre"]')!);
  fireEvent.click(document.querySelector('[data-host-command-snippet="post"]')!);
  fireEvent.click(document.querySelector("[data-encoding]")!);
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    host: "srv",
    pre_command: "pre-cmd",
    post_snippet_id: "post-snip",
    terminal_encoding: "utf-8",
  });
});

test("ssh form submits its proxy override and only a typed proxy password", async () => {
  const { onSubmit, ref } = renderSsh({ initial: conn({ proxy: { mode: "socks5", host: "p.example", port: 1080 } }) });
  fireEvent.change(screen.getByLabelText("connections.form.proxy.port"), { target: { value: "1081" } });
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ proxy: { mode: "socks5", host: "p.example", port: 1081 } });
  expect(onSubmit.mock.calls[0][1].proxy_password).toBeNull();
  fireEvent.change(screen.getByLabelText("connections.form.proxy.password"), { target: { value: "pw" } });
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit.mock.calls[1][1].proxy_password).toBe("pw");
});

test.each([
  [undefined, false],
  [{ mode: "direct" as const }, false],
  [{ mode: "system" as const }, false],
  [{ mode: "socks5" as const, host: "p" }, true],
  [{ mode: "http" as const, host: "p" }, true],
])("ssh form reads the saved proxy password only for a custom proxy (%j)", async (proxy, reads) => {
  const { getSecret } = await import("@/services/vault");
  renderSsh({ initial: conn({ proxy }) });
  await act(async () => { await Promise.resolve(); });
  expect((getSecret as ReturnType<typeof vi.fn>).mock.calls.some(([k]) => k === "proxy_password:c1")).toBe(reads);
});

test("ssh form locks the proxy fields without edit permission", async () => {
  renderSsh({ initial: lockedConn({ proxy: { mode: "http", host: "p.example", port: 8080 } }) });
  await act(async () => { await Promise.resolve(); });
  expect((screen.getByLabelText("connections.form.proxy.host") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "connections.form.proxy.label" }) as HTMLButtonElement).disabled).toBe(true);
});

test("serial form submits its host commands with the serial defaults", async () => {
  const { onSubmit, ref } = renderSerial();
  fireEvent.click(document.querySelector('[data-host-command-text="pre"]')!);
  fireEvent.click(document.querySelector("[data-encoding]")!);
  const portInput = document.querySelector("input") as HTMLInputElement;
  expect(portInput).toBeTruthy();
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByPlaceholderText("connections.serialForm.namePlaceholder"), {
    target: { value: "board" },
  });
  const inputs = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
  const serialPortInput = inputs.find((i) => i.getAttribute("placeholder") !== "connections.serialForm.namePlaceholder");
  fireEvent.change(serialPortInput!, { target: { value: "/dev/ttyUSB0" } });
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    name: "board",
    connection_type: "serial",
    serial_port: "/dev/ttyUSB0",
    serial_baud: 115200,
    serial_data_bits: 8,
    serial_parity: "none",
    serial_stop_bits: 1,
    serial_flow_control: "none",
    pre_command: "pre-cmd",
    terminal_encoding: "utf-8",
    host: "",
    port: 0,
    username: "",
    auth_type: "password",
  });
});

test("the ask-vars checkbox appears only once a snippet is picked, on both forms", () => {
  renderSsh();
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  fireEvent.click(document.querySelector('[data-host-command-snippet="pre"]')!);
  expect(document.querySelector('input[type="checkbox"]')).toBeTruthy();
  cleanup();
  renderSerial();
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  fireEvent.click(document.querySelector('[data-host-command-snippet="post"]')!);
  expect(document.querySelector('input[type="checkbox"]')).toBeTruthy();
});

test("the serial form lists the discovered ports and keeps existing notes on save", async () => {
  const { onSubmit, ref } = renderSerial({ initial: conn({ connection_type: "serial", serial_port: "/dev/ttyS0", notes: "keep me" }) as Connection });
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByPlaceholderText("connections.serialForm.namePlaceholder"), { target: { value: "renamed" } });
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ notes: "keep me", name: "renamed" });
});

test.each([
  ["ssh", () => renderSsh({ initial: conn() })],
  ["serial", () => renderSerial({ initial: conn({ connection_type: "serial", serial_port: "/dev/ttyS0" }) as Connection })],
])("%s form edits notes and saves blank notes as undefined", async (_kind, mount) => {
  const { onSubmit, ref } = mount();
  await act(async () => { await Promise.resolve(); });
  const notes = document.querySelector("[data-notes]") as HTMLTextAreaElement;
  fireEvent.change(notes, { target: { value: "## Runbook\n- [ ] check disk" } });
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]).toMatchObject({ notes: "## Runbook\n- [ ] check disk" });
  fireEvent.change(notes, { target: { value: "   " } });
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0].notes).toBeUndefined();
});

test.each([
  ["ssh", () => renderSsh({ initial: conn(), onSubmit: vi.fn(async () => { throw new RuleSetMoveCancelled(); }) })],
  ["serial", () => renderSerial({ initial: conn({ connection_type: "serial", serial_port: "/dev/ttyS0" }) as Connection, onSubmit: vi.fn(async () => { throw new RuleSetMoveCancelled(); }) })],
])("%s form puts the saved folder back when the move is cancelled", async (_kind, mount) => {
  const { ref } = mount();
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(document.querySelector("[data-folder-pick]")!);
  expect(document.querySelector("[data-folder-selector]")?.getAttribute("data-value")).toBe("f1");
  await act(async () => { ref.current!.flush(); });
  expect(document.querySelector("[data-folder-selector]")?.getAttribute("data-value")).toBe("");
});

test.each([
  ["ssh", (canEdit: boolean) => renderSsh({ initial: (canEdit ? conn : lockedConn)() })],
  ["serial", (canEdit: boolean) => renderSerial({ initial: (canEdit ? conn : lockedConn)({ connection_type: "serial", serial_port: "/dev/ttyS0" }) })],
])("%s form renders notes read-only without edit permission", async (_kind, mount) => {
  mount(true);
  await act(async () => { await Promise.resolve(); });
  expect((document.querySelector("[data-notes]") as HTMLTextAreaElement).readOnly).toBe(false);
  cleanup();
  mount(false);
  await act(async () => { await Promise.resolve(); });
  expect((document.querySelector("[data-notes]") as HTMLTextAreaElement).readOnly).toBe(true);
});

test("a dirty edit marks the form dirty on both forms", () => {
  const ssh = renderSsh();
  expect(ssh.ref.current!.isDirty()).toBe(false);
  fireEvent.click(document.querySelector("[data-tag-selector]")!);
  expect(ssh.ref.current!.isDirty()).toBe(true);
  cleanup();
  const serial = renderSerial();
  expect(serial.ref.current!.isDirty()).toBe(false);
  fireEvent.click(document.querySelector("[data-tag-selector]")!);
  expect(serial.ref.current!.isDirty()).toBe(true);
});

// #252: macOS capitalised the first letter of the SSH username on blur, so
// `abcd` was saved as `Abcd`, a different login on a case-sensitive host.
// autocorrect and spellcheck are the two that actually stop it in WKWebView;
// autocapitalize covers virtual keyboards on the Android build.
test("the ssh username field opts out of OS capitalisation and autocorrect", () => {
  renderSsh();
  const username = screen.getByPlaceholderText("root");
  expect(username.getAttribute("autocapitalize")).toBe("off");
  expect(username.getAttribute("autocorrect")).toBe("off");
  expect(username.getAttribute("spellcheck")).toBe("false");
});

function grantOnC1(permissions: number) {
  useTeamObjectAccessStore.getState().replaceTeam("team-1", {
    c1: { type: "connection", ruleSetId: "s1", myPermissions: permissions, parentId: null, deleted: false },
  }, true);
}

test("ssh form locks its fields and drops unsaved input when edit access is revoked", async () => {
  h.teams = [{ id: "team-1" }];
  grantOnC1(PERM_BITS.VIEW | PERM_BITS.VIEW_SECRETS | PERM_BITS.EDIT_CONNECTIONS);
  const { onSubmit } = renderSsh({ initial: conn({ vault_id: "team-1" }) });
  const hostInput = () => screen.getByPlaceholderText("connections.form.hostPlaceholder") as HTMLInputElement;
  expect(hostInput().matches(":disabled")).toBe(false);
  fireEvent.change(hostInput(), { target: { value: "typed.example" } });

  act(() => grantOnC1(PERM_BITS.VIEW | PERM_BITS.VIEW_SECRETS));

  expect(hostInput().matches(":disabled")).toBe(true);
  expect(hostInput().value).toBe("h.example");
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(onSubmit).not.toHaveBeenCalled();
  useTeamObjectAccessStore.getState().clearAll();
});

test("ssh form hides its secret fields without View secrets, with no banner", async () => {
  h.teams = [{ id: "team-1" }];
  grantOnC1(PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS);
  renderSsh({ initial: conn({ vault_id: "team-1" }) });
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText("connections.common.password")).toBeNull();
  expect(screen.queryByPlaceholderText("-----BEGIN OPENSSH PRIVATE KEY-----\n...")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();

  act(() => grantOnC1(PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS | PERM_BITS.VIEW_SECRETS));
  expect(screen.getByText("connections.common.password")).toBeTruthy();
  useTeamObjectAccessStore.getState().clearAll();
});

async function withStoredKnock(run: () => Promise<void>) {
  const { getSecret } = await import("@/services/vault");
  (getSecret as ReturnType<typeof vi.fn>).mockImplementation(async (k: string) => (k === "knock_sequence:c1" ? "666/tcp" : null));
  try { await run(); } finally { (getSecret as ReturnType<typeof vi.fn>).mockImplementation(async () => null); }
}

test("ssh form loads the saved sequence and submits an edited one with the knock settings", () => withStoredKnock(async () => {
  const { onSubmit, ref } = renderSsh({ initial: conn({ port_knock: { enabled: true, window_secs: 60 } }) });
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByDisplayValue("666")).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("connections.form.hostPlaceholder"), { target: { value: "srv" } });
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ port_knock: { enabled: true, window_secs: 60 } });
  expect(onSubmit.mock.calls[0][1].knock_sequence).toBeNull();
  fireEvent.change(screen.getByDisplayValue("666"), { target: { value: "667" } });
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[1][1].knock_sequence).toBe("667/tcp");
}));

test.each([
  ["a blank row while enabled", true, () => fireEvent.click(screen.getByText("connections.knock.addPort")), null],
  ["an out-of-range port while enabled", true, () => fireEvent.change(screen.getByDisplayValue("666"), { target: { value: "99999" } }), null],
  ["removing every row while enabled", true, () => fireEvent.click(screen.getByLabelText("connections.knock.remove")), null],
  ["removing every row while disabled", false, () => fireEvent.click(screen.getByLabelText("connections.knock.remove")), ""],
] as const)("%s saves the expected knock_sequence", (_name, enabled, edit, want) => withStoredKnock(async () => {
  const { onSubmit, ref } = renderSsh({ initial: conn({ port_knock: { enabled } }) });
  await act(async () => { await Promise.resolve(); });
  edit();
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[0][1].knock_sequence).toBe(want);
}));

test("an ftp host never reads the knock sequence", async () => {
  const { getSecret } = await import("@/services/vault");
  renderSsh({ initial: conn({ connection_type: "ftp", port: 21 }) });
  await act(async () => { await Promise.resolve(); });
  expect(getSecret).not.toHaveBeenCalledWith("knock_sequence:c1");
});

test("a host without knocking submits no knock settings", async () => {
  const { onSubmit, ref } = renderSsh();
  fireEvent.change(screen.getByPlaceholderText("connections.form.hostPlaceholder"), { target: { value: "srv" } });
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[0][0].port_knock).toBeUndefined();
  expect(onSubmit.mock.calls[0][1].knock_sequence).toBeNull();
});

test("without View secrets the knock ports stay hidden and a save leaves the sequence untouched", () => withStoredKnock(async () => {
  h.teams = [{ id: "team-1" }];
  grantOnC1(PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS);
  const { getSecret } = await import("@/services/vault");
  const { onSubmit, ref } = renderSsh({ initial: conn({ vault_id: "team-1", port_knock: { enabled: true } }) });
  await act(async () => { await Promise.resolve(); });
  expect(getSecret).not.toHaveBeenCalledWith("knock_sequence:c1");
  expect(screen.queryByDisplayValue("666")).toBeNull();
  expect(screen.queryByText("connections.knock.addPort")).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("connections.form.hostPlaceholder"), { target: { value: "srv" } });
  await act(async () => { ref.current!.flush(); });
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ port_knock: { enabled: true } });
  expect(onSubmit.mock.calls[0][1].knock_sequence).toBeNull();
  useTeamObjectAccessStore.getState().clearAll();
}));

test("a new ssh host keeps its secret fields in a vault whose secrets the caller cannot view", () => {
  h.teams = [{ id: "team-1" }];
  h.defaultVaultId = "team-1";
  renderSsh();
  expect(screen.getByText("connections.common.password")).toBeTruthy();
});

test("webdav form submits the URL with the host and port it derives", async () => {
  const { onSubmit, ref } = renderSsh({
    initial: conn({ connection_type: "webdav", webdav_url: "https://dav.example/files/", host: "dav.example", port: 443 }),
  });
  fireEvent.change(screen.getByPlaceholderText("connections.form.webdavUrlPlaceholder"), {
    target: { value: "http://nas.local:5005/dav" },
  });
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]).toMatchObject({
    connection_type: "webdav",
    webdav_url: "http://nas.local:5005/dav/",
    host: "nas.local",
    port: 5005,
    auth_type: "password",
  });
  expect(document.querySelector("[data-webdav-plaintext]")).toBeTruthy();
  expect(screen.queryByText("connections.form.keychainIdentity")).toBeNull();
  expect(screen.queryByPlaceholderText("connections.form.hostPlaceholder")).toBeNull();
});

test("webdav form refuses to save an unusable URL", async () => {
  const { onSubmit, ref } = renderSsh({
    initial: conn({ connection_type: "webdav", webdav_url: "https://dav.example/files/" }),
  });
  fireEvent.change(screen.getByPlaceholderText("connections.form.webdavUrlPlaceholder"), {
    target: { value: "ftp://nas.local/" },
  });
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(document.querySelector("[data-webdav-url-error]")).toBeTruthy();
});

const usernameField = () => screen.getByText("connections.common.username").parentElement!.querySelector("input")!;
const pickProtocol = (current: string, next: string) => {
  fireEvent.click(screen.getAllByText(`connections.form.${current}`)[0]);
  const options = screen.getAllByText(`connections.form.${next}`);
  fireEvent.click(options[options.length - 1]);
};

test("leaving webdav resets the port its URL derived", async () => {
  const { onSubmit, ref } = renderSsh({
    initial: conn({ connection_type: "webdav", webdav_url: "https://dav.example/files/", host: "dav.example", port: 443 }),
  });
  pickProtocol("protocolWebdav", "protocolSsh");
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]).toMatchObject({ host: "dav.example", port: 22 });
});

test("a new file-only host starts with no username", () => {
  renderSsh({ initial: { connection_type: "ftp" } as Connection });
  expect(usernameField().value).toBe("");
});

test("switching protocol swaps an untouched default username", () => {
  renderSsh();
  expect(usernameField().value).toBe("root");
  pickProtocol("protocolSsh", "protocolWebdav");
  expect(usernameField().value).toBe("");
  pickProtocol("protocolWebdav", "protocolSsh");
  expect(usernameField().value).toBe("root");
});

test("switching protocol keeps a typed username", () => {
  renderSsh();
  fireEvent.change(usernameField(), { target: { value: "alice" } });
  pickProtocol("protocolSsh", "protocolFtp");
  expect(usernameField().value).toBe("alice");
});

test.each([
  ["ssh", renderSsh],
  ["serial", renderSerial],
])("%s form labels the pre/post commands as session commands", (_kind, mount) => {
  mount();
  expect(screen.getByText("connections.common.sessionCommands")).toBeTruthy();
  expect(screen.getByText("connections.common.sessionCommandsHint")).toBeTruthy();
});
