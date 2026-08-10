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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

vi.mock("@/stores/folderStore", () => ({
  useFolderStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const state = { folders: h.folders, loadFolders: h.loadFolders, saveFolder: h.saveFolder };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ folders: h.folders, loadFolders: h.loadFolders, saveFolder: h.saveFolder }) },
  ),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel?: (s: unknown) => unknown) => {
    const state = { pinConnection: h.pinConnection, setDistro: h.setDistro };
    return sel ? sel(state) : state;
  },
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const state = { teams: h.teams };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ teams: h.teams }) },
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
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ useToggle: () => [false, vi.fn()] }));
vi.mock("@/stores/connectivitySettingsStore", () => ({
  useGlobalKeepalivePreset: () => ["balanced", vi.fn()],
}));
vi.mock("@/stores/hostCommandVarsStore", () => ({ clearRememberedVars: vi.fn() }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
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
vi.mock("./DistroIconPicker", () => ({ DistroIconPicker: () => null }));
vi.mock("./IdentitySelector", () => ({ default: () => null }));
vi.mock("./KeySelector", () => ({ default: () => null }));
vi.mock("./JumpHostsPanel", () => ({ default: () => null }));
vi.mock("./EnvVarsPanel", () => ({ default: () => null }));

const { default: ConnectionForm } = await import("./ConnectionForm");
const { default: SerialConnectionForm } = await import("./SerialConnectionForm");
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
    <ConnectionForm ref={ref} onSubmit={onSubmit} onClose={vi.fn()} canEdit {...props} />,
  );
  return { onSubmit, ref };
}
function renderSerial(props: Partial<Parameters<typeof SerialConnectionForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const ref = createRef<FormHandle>();
  render(
    <SerialConnectionForm ref={ref} onSubmit={onSubmit} onClose={vi.fn()} canEdit {...props} />,
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
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByPlaceholderText("connections.serialForm.namePlaceholder"), {
    target: { value: "renamed" },
  });
  await act(async () => {
    ref.current!.flush();
  });
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ notes: "keep me", name: "renamed" });
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
