import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAuditClientEvent } from "@/services/auditReporter";
import { useKeyStore } from "@/stores/keyStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useFolderStore } from "@/stores/folderStore";
import FolderSelector from "@/components/shared/FolderSelector";
import TagSelector from "@/components/shared/TagSelector";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { storeSecret, getSecret } from "@/services/vault";
import {
  PanelShell, PanelHeader, FormSection,
  formInputClass, formInputStyle, formLabelClass, formLabelStyle,
} from "@/components/shared/Panel";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useIdentityStore } from "@/stores/identityStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { KeyFileDropZone } from "./KeyForm";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import type { AuthType, Connection, Identity, IdentityFormData } from "@/types";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import { selectVaultScopedItems } from "@/utils/vaultScopedItems";

// ─────────────────────────────────────────────────────────────────
// Dropdown sub-components (used by KeySelector)
// ─────────────────────────────────────────────────────────────────

function DropdownItem({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
      style={{ color: active ? "var(--t-accent)" : "var(--t-text-secondary)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <Icon icon={icon} width={13} className="shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {active && <Icon icon="lucide:check" width={13} className="text-(--t-accent)" />}
    </button>
  );
}

function DropdownDivider() {
  return <div className="my-1 border-t border-t-(--t-bg-card-hover)" />;
}

// ─────────────────────────────────────────────────────────────────
// KeySelector dropdown
// ─────────────────────────────────────────────────────────────────

function KeySelector({
  value, onChange, vaultId,
}: {
  value: string | null | "__inline__";
  onChange: (id: string | null) => void;
  vaultId: string;
}) {
  const { keys: personalKeys, teamKeys } = useKeyStore();
  const teams = useTeamStore((s) => s.teams);
  const teamVaultIds = useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  const effectiveVaultId = vaultId || "personal";
  const keys = useMemo(() => selectVaultScopedItems({
    vaultId: effectiveVaultId,
    localItems: personalKeys,
    teamItems: teamKeys,
    teamVaultIds,
    resolveVaultId: resolveVaultIdForSave,
  }), [effectiveVaultId, personalKeys, teamKeys, teamVaultIds]);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left: number; width: number }>({ left: 0, width: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isInline = value === "__inline__";
  const selected = isInline ? null : (keys.find((k) => k.id === value) ?? null);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      const estimatedHeight = 12 + 2 * 33 + (keys.length > 0 ? 9 + keys.length * 33 : 0);
      const spaceBelow = window.innerHeight - r.bottom;
      if (spaceBelow < estimatedHeight) {
        setDropdownPos({ bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width });
      } else {
        setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        style={{ ...formInputStyle, color: (selected || isInline) ? "var(--t-text-primary)" : "var(--t-text-dim)" }}
      >
        <Icon icon={isInline ? "lucide:file-key" : selected ? "lucide:key-round" : "lucide:minus"} width={13} className="shrink-0" />
        <span className="flex-1 text-left truncate text-xs">
          {isInline ? "New key (inline)..." : selected ? (selected.name ?? "Unnamed Key") : "No key"}
        </span>
        <Icon
          icon="lucide:chevron-down"
          width={13}
          className="text-(--t-text-dim) shrink-0"
          style={{
            transition: "transform 150ms",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {open && (
        <div
          className="p-1.5 rounded-xl fixed z-9999 bg-(--t-bg-card) border border-(--t-bg-card-hover)"
          style={{
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            left: dropdownPos.left,
            width: dropdownPos.width,
            boxShadow: "var(--t-elev-2)",
          }}
        >
          <DropdownItem
            icon="lucide:minus"
            label="No key"
            active={value === null}
            onClick={() => { onChange(null); setOpen(false); }}
          />
          <DropdownItem
            icon="lucide:file-key"
            label="New key (inline)..."
            active={value === "__inline__"}
            onClick={() => { onChange("__inline__"); setOpen(false); }}
          />
          {keys.length > 0 && <DropdownDivider />}
          {keys.map((k) => (
            <DropdownItem
              key={k.id}
              icon="lucide:key-round"
              label={k.name ?? k.id}
              active={value === k.id}
              onClick={() => { onChange(k.id); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// IdentityForm (side panel)
// ─────────────────────────────────────────────────────────────────

export interface IdentityFormProps {
  initial?: Identity;
  onSubmit: (
    data: IdentityFormData,
    password: string | null,
    inlineKeyMaterial?: { label?: string; privateKey: string; publicKey: string },
  ) => void | Promise<void>;
  onClose: () => void;
  onDelete?: (id: string) => void;
  flushRef?: { current: (() => void) | null };
  isDirtyRef?: React.MutableRefObject<boolean>;
  vaults?: import("@/types").VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
}

export function IdentityForm({ initial, onSubmit, onClose, onDelete, flushRef, isDirtyRef, vaults, canEdit, onMoveToVault, onCopyToVault }: IdentityFormProps) {
  const { loadKeys } = useKeyStore();
  const { connections, loadConnections, updateConnection } = useConnectionStore();
  const { setActiveNav, setHomePendingAction } = useUIStore();
  const pinIdentity = useIdentityStore((s) => s.pinIdentity);
  const effPinned = useEffectivePinned(initial ?? { id: "", pinned: false }, "identity");
  const pinSource = useEffectivePinSource(initial ?? { id: "", pinned: false }, "identity");
  const isPinned = effPinned;
  const isTeamVault = useTeamStore((s) => initial ? s.teams.some((t) => t.id === initial.vault_id) : false);
  const contributions = useUIContributions("identity.panelActions", initial);
  const { toggleExcluded, isObjectSynced } = useSyncPrefsStore();
  const isSynced = initial ? isObjectSynced(initial.id, "identity") : true;
  const [name, setName] = useState(initial?.name ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keyId, setKeyId] = useState<string | null | "__inline__">(initial?.key_id ?? null);
  const [folderId, setFolderId] = useState<string | null>(initial?.folder_id ?? null);
  const defaultVaultId = useDefaultVaultId();
  const [vaultId, setVaultId] = useState<string>(() => initial?.vault_id ?? defaultVaultId);
  const isNew = !initial;
  const vaultPickerTouched = useRef(false);
  useEffect(() => {
    if (isNew && !vaultPickerTouched.current) {
      setVaultId(defaultVaultId);
    }
  }, [isNew, defaultVaultId]);
  const [inlineKeyLabel, setInlineKeyLabel] = useState("");
  const [inlinePrivKey, setInlinePrivKey] = useState("");
  const [inlinePublicKey, setInlinePublicKey] = useState("");
  const passwordDirty = useRef(false);
  const { folders, loadFolders, saveFolder } = useFolderStore();

  const linkedHosts = useMemo(
    () => (initial ? connections.filter((c) => c.identity_id === initial.id) : []),
    [connections, initial?.id],
  );

  const handleUnlink = async (conn: Connection) => {
    if (!initial) return;
    const identityPassword = await getSecret(`identity:${initial.id}:password`).catch(() => null);
    const identityPrivKey = initial.key_id
      ? await getSecret(`key:${initial.key_id}:private`).catch(() => null)
      : null;
    const authType: AuthType = identityPrivKey ? "key" : "password";
    await updateConnection(conn.id, {
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: initial.username,
      auth_type: authType,
      tags: conn.tags,
      identity_id: undefined,
      folder_id: conn.folder_id,
    });
    if (identityPassword) await storeSecret(`password:${conn.id}`, identityPassword);
    if (identityPrivKey) await storeSecret(`key:${conn.id}`, identityPrivKey);
  };

  const isInline = keyId === "__inline__";

  useEffect(() => {
    void loadKeys();
    void loadConnections();
    void loadFolders();
  }, []);

  useEffect(() => {
    if (!initial) return;
    (async () => {
      const pwd = await getSecret(`identity:${initial.id}:password`).catch(() => null);
      if (pwd && !passwordDirty.current) setPassword(pwd);
    })();
  }, [initial?.id]);

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => {
      const keyMaterial = isInline
        ? { label: inlineKeyLabel || undefined, privateKey: inlinePrivKey, publicKey: inlinePublicKey }
        : undefined;
      return onSubmit(
        { name: name.trim() || undefined, username, key_id: isInline ? undefined : (keyId ?? undefined), tags, folder_id: folderId ?? undefined, vault_id: resolveVaultIdForSave(vaultId) },
        passwordDirty.current ? password : null,
        keyMaterial,
      ) ?? undefined;
    },
    canSave: () => !!username.trim() && (!isInline || !!inlinePrivKey.trim()),
  });
  const markDirty = useCallback(() => {
    if (isDirtyRef) isDirtyRef.current = true;
    _markDirty();
  }, [_markDirty, isDirtyRef]);

  if (flushRef) flushRef.current = flush;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, tags, username, password, keyId, folderId, vaultId, inlineKeyLabel, inlinePrivKey, inlinePublicKey]);

  const handleClose = () => flushAndClose(onClose);

  const handleTogglePassword = useCallback(() => {
    if (!showPassword && initial && password) {
      reportAuditClientEvent(auditContextForVaultId(vaultId), "secret.viewed", {
        target_type: "identity",
        target_id: initial.id,
        target_name: initial.name?.trim() || initial.username,
        metadata: { kind: "password" },
      });
    }
    setShowPassword((v) => !v);
  }, [showPassword, initial, password, vaultId]);

  return (
    <PanelShell>
      <PanelHeader
        icon={initial ? "lucide:pencil" : "lucide:plus"}
        title={initial ? "Edit Identity" : "New Identity"}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => { vaultPickerTouched.current = true; setVaultId(id); markDirty(); }} />}
        onClose={handleClose}
        saveState={saveState}
        actions={initial ? (() => {
          const items = [
            ...contributions.map((a) => ({ ...a, icon: a.icon ?? "lucide:chevron-right" })),
            ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault),
            {
              label: isSynced ? "Disable cloud sync" : "Enable cloud sync",
              icon: isSynced ? "lucide:cloud-off" : "lucide:cloud",
              onClick: () => toggleExcluded(initial.id),
              divider: true,
            },
            ...(onDelete ? [{ label: "Delete", icon: "lucide:trash-2", onClick: () => { onDelete(initial.id); onClose(); }, danger: true, divider: false, shortcut: getShortcutHint("delete") }] : []),
          ];
          return (
            <>
              <PinButton pinned={isPinned} onToggle={() => {
                if (!isTeamVault) {
                  pinIdentity(initial.id, !isPinned).catch(() => {});
                } else {
                  pinIdentity(initial.id, nextPersonalPinValue(pinSource)).catch(() => {});
                }
              }} />
              {items.length > 0 && <PanelActionsMenu items={items} />}
            </>
          );
        })() : undefined}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <FormSection label="General">
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Label</label>
            <input
              className={formInputClass}
              style={formInputStyle}
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              placeholder="My Identity (optional)"
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Tags</label>
            <TagSelector
              value={tags}
              vaultId={vaultId}
              onChange={(next) => { markDirty(); setTags(next); }}
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Folder</label>
            <FolderSelector
              value={folderId}
              folders={folders}
              onChange={(id) => { markDirty(); setFolderId(id); }}
              onCreateFolder={async (name) => {
                const folder = await saveFolder({ name, object_type: "connection", vault_id: resolveVaultIdForSave(vaultId) || undefined });
                markDirty();
                setFolderId(folder.id);
                return folder.id;
              }}
            />
          </div>
        </FormSection>

        <FormSection label="Credentials">
          <div>
            <label className={formLabelClass} style={formLabelStyle}>
              Username <span className="text-(--t-accent)">*</span>
            </label>
            <input
              className={formInputClass}
              style={formInputStyle}
              value={username}
              onChange={(e) => { markDirty(); setUsername(e.target.value); }}
              placeholder="root"
            />
          </div>

          <div>
            <label className={formLabelClass} style={formLabelStyle}>Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className={`${formInputClass} pr-9`}
                style={formInputStyle}
                value={password}
                onChange={(e) => { markDirty(); passwordDirty.current = true; setPassword(e.target.value); }}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={handleTogglePassword}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors text-(--t-text-dim)"
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
                tabIndex={-1}
              >
                <Icon icon={showPassword ? "lucide:eye-off" : "lucide:eye"} width={14} />
              </button>
            </div>
          </div>

          <div>
            <label className={formLabelClass} style={formLabelStyle}>SSH Key</label>
            <KeySelector
              value={keyId}
              onChange={(v) => { markDirty(); setKeyId(v); setInlinePrivKey(""); setInlinePublicKey(""); setInlineKeyLabel(""); }}
              vaultId={vaultId}
            />
          </div>
        </FormSection>

        {isInline && (
          <FormSection label="New Key Material">
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Key Label</label>
              <input
                className={formInputClass}
                style={formInputStyle}
                value={inlineKeyLabel}
                onChange={(e) => { markDirty(); setInlineKeyLabel(e.target.value); }}
                placeholder="My SSH Key (optional)"
              />
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>
                Private Key <span className="text-(--t-accent)">*</span>
              </label>
              <textarea
                className={`${formInputClass} font-mono text-xs h-28 resize-none`}
                style={formInputStyle}
                value={inlinePrivKey}
                onChange={(e) => { markDirty(); setInlinePrivKey(e.target.value); }}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
              />
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>
                Public Key <span className="text-(--t-text-dim) font-normal">(optional)</span>
              </label>
              <textarea
                className={`${formInputClass} font-mono text-xs h-16 resize-none`}
                style={formInputStyle}
                value={inlinePublicKey}
                onChange={(e) => { markDirty(); setInlinePublicKey(e.target.value); }}
                placeholder="ssh-ed25519 AAAA..."
              />
            </div>
            <KeyFileDropZone
              onPrivateKey={(v) => { markDirty(); setInlinePrivKey(v); }}
              onPublicKey={(v) => { markDirty(); setInlinePublicKey(v); }}
            />
          </FormSection>
        )}

        {initial && linkedHosts.length > 0 && (
          <FormSection label="Linked to">
            <div className="space-y-1 p-1">
              {linkedHosts.map((c) => {
                const displayIcon = c.icon || c.distro;
                const distroIcon = displayIcon ? getConnectionIcon(displayIcon) : null;
                const distroBg = displayIcon ? getConnectionIconColor(displayIcon) : null;
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-(--t-bg-base)"
                  >
                    <div
                      className="rounded-md flex items-center justify-center shrink-0 text-white"
                      style={{ width: "1.867rem", height: "1.867rem", background: distroBg ?? "var(--t-bg-card-avatar)" }}
                    >
                      <Icon icon={distroIcon ?? "lucide:server"} width={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate font-medium text-(--t-text-bright)">
                        {c.name ?? `${c.username}@${c.host}`}
                      </p>
                      <p className="text-xs truncate text-(--t-text-secondary)">
                        {c.username}@{c.host}:{c.port}
                      </p>
                    </div>
                    <button
                      onClick={() => { setActiveNav("hosts"); setHomePendingAction({ action: "edit", id: c.id }); onClose(); }}
                      title="Edit host"
                      className="p-1.5 rounded-lg transition-colors shrink-0 text-(--t-text-dim)"
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; e.currentTarget.style.background = "transparent"; }}
                    >
                      <Icon icon="lucide:pencil" width={14} />
                    </button>
                    <button
                      onClick={() => { void handleUnlink(c); }}
                      title="Unlink — copy credentials inline to host"
                      className="p-1.5 rounded-lg transition-colors shrink-0 text-(--t-text-dim)"
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-status-error, #ef4444)"; e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; e.currentTarget.style.background = "transparent"; }}
                    >
                      <Icon icon="lucide:unlink" width={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </FormSection>
        )}
      </div>
    </PanelShell>
  );
}
