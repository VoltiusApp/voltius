import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { getSecret } from "@/services/vault";
import {
  PanelShell, PanelHeader, FormSection,
  formInputClass, formInputStyle, formLabelClass, formLabelStyle,
} from "@/components/shared/Panel";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useFolderStore } from "@/stores/folderStore";
import FolderSelector from "@/components/shared/FolderSelector";
import TagSelector from "@/components/shared/TagSelector";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { VaultPicker } from "@/components/shared/VaultPicker";
import type { SshKey, SshKeyFormData } from "@/types";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";

// ─────────────────────────────────────────────────────────────────
// Key detection
// ─────────────────────────────────────────────────────────────────

export const PUB_TYPE_MAP: Record<string, string> = {
  "ssh-ed25519": "ED25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA P-256",
  "ecdsa-sha2-nistp384": "ECDSA P-384",
  "ecdsa-sha2-nistp521": "ECDSA P-521",
  "ssh-dss": "DSA",
};

export function detectKeyInfo(
  privateKey: string,
  publicKey: string,
): { type: string | null; valid: boolean; error?: string } {
  const pk = privateKey.trim();
  if (!pk) return { type: null, valid: true };

  const pemTypes: [string, string, string][] = [
    ["-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----", "RSA"],
    ["-----BEGIN EC PRIVATE KEY-----", "-----END EC PRIVATE KEY-----", "ECDSA"],
    ["-----BEGIN DSA PRIVATE KEY-----", "-----END DSA PRIVATE KEY-----", "DSA"],
    ["-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----", "PKCS8"],
  ];
  for (const [header, footer, type] of pemTypes) {
    if (pk.startsWith(header)) {
      return { type, valid: pk.includes(footer) };
    }
  }

  if (pk.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) {
    if (!pk.includes("-----END OPENSSH PRIVATE KEY-----")) {
      return { type: null, valid: false, error: "Incomplete key" };
    }

    const pub = publicKey.trim();
    for (const [prefix, type] of Object.entries(PUB_TYPE_MAP)) {
      if (pub.startsWith(prefix)) return { type, valid: true };
    }

    try {
      const b64 = pk
        .replace("-----BEGIN OPENSSH PRIVATE KEY-----", "")
        .replace("-----END OPENSSH PRIVATE KEY-----", "")
        .replace(/\s/g, "");
      const bin = atob(b64);

      const magic = "openssh-key-v1\0";
      if (!bin.startsWith(magic)) return { type: "OpenSSH", valid: true };

      const u32 = (p: number) =>
        (((bin.charCodeAt(p) << 24) | (bin.charCodeAt(p + 1) << 16) |
          (bin.charCodeAt(p + 2) << 8) | bin.charCodeAt(p + 3)) >>> 0);
      const skipStr = (p: number) => p + 4 + u32(p);

      let pos = magic.length;
      pos = skipStr(pos); // cipher
      pos = skipStr(pos); // kdf
      pos = skipStr(pos); // kdf options
      pos += 4;           // num keys

      pos += 4;           // skip pubkey block length
      const typeLen = u32(pos);
      pos += 4;
      const keyType = bin.slice(pos, pos + typeLen);

      return { type: PUB_TYPE_MAP[keyType] ?? keyType, valid: true };
    } catch {
      return { type: "OpenSSH", valid: true };
    }
  }

  return { type: null, valid: false, error: "Unrecognized key format" };
}

// ─────────────────────────────────────────────────────────────────
// KeyFileDropZone
// ─────────────────────────────────────────────────────────────────

export function KeyFileDropZone({
  onPrivateKey,
  onPublicKey,
}: {
  onPrivateKey: (v: string) => void;
  onPublicKey: (v: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const counterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      const isPublic =
        file.name.endsWith(".pub") ||
        /^(ssh-|ecdsa-|sk-)/.test(text.trimStart());
      if (isPublic) {
        onPublicKey(text.trim());
      } else {
        onPrivateKey(text.trim());
      }
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 2000);
    };
    reader.onerror = () => {
      setStatus("err");
      setTimeout(() => setStatus("idle"), 2000);
    };
    reader.readAsText(file);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current -= 1;
    if (counterRef.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const borderColor = dragging
    ? "var(--t-accent)"
    : status === "ok"
    ? "var(--t-status-connected)"
    : status === "err"
    ? "var(--t-status-error)"
    : "var(--t-border)";

  const bgColor = dragging
    ? "color-mix(in srgb, var(--t-accent) 8%, transparent)"
    : "transparent";

  const iconColor = dragging
    ? "var(--t-accent)"
    : status === "ok"
    ? "var(--t-status-connected)"
    : status === "err"
    ? "var(--t-status-error)"
    : "var(--t-text-dim)";

  return (
    <div
      className="m-3 flex flex-col items-center justify-center gap-2 rounded-lg py-5 transition-all duration-150"
      style={{
        border: `1.5px dashed ${borderColor}`,
        background: bgColor,
        cursor: "pointer",
      }}
      onClick={() => inputRef.current?.click()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pem,.key,.pub,.ppk,*"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      <Icon
        icon={
          status === "ok"
            ? "lucide:check-circle"
            : status === "err"
            ? "lucide:x-circle"
            : dragging
            ? "lucide:file-down"
            : "lucide:import"
        }
        width={22}
        style={{ color: iconColor, transition: "color 0.15s" }}
      />
      <p className="text-xs text-center" style={{ color: iconColor, transition: "color 0.15s" }}>
        {status === "ok"
          ? "Key file loaded"
          : status === "err"
          ? "Could not read file"
          : dragging
          ? "Drop to load key file"
          : "Drop a key file here"}
      </p>
      {status === "idle" && (
        <p className="text-xs text-[var(--t-text-muted)]">
          .pem, .key, .pub or any SSH key file
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// KeyForm (side panel)
// ─────────────────────────────────────────────────────────────────

export interface KeyFormProps {
  initial?: SshKey;
  onSubmit: (data: SshKeyFormData, privateKey: string | null, publicKey: string | null, passphrase: string | null) => void | Promise<void>;
  onClose: () => void;
  onExport?: (key: SshKey) => void;
  onDelete?: (id: string) => void;
  flushRef?: { current: (() => void) | null };
  isDirtyRef?: React.MutableRefObject<boolean>;
  vaults?: import("@/types").VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
}

export function KeyForm({ initial, onSubmit, onClose, onExport, onDelete, flushRef, isDirtyRef, vaults, canEdit, onMoveToVault, onCopyToVault }: KeyFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
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
  const keyInfo = useMemo(() => detectKeyInfo(privateKey, publicKey), [privateKey, publicKey]);
  const privateKeyDirty = useRef(false);
  const publicKeyDirty = useRef(false);
  const passphraseDirty = useRef(false);
  const { folders, loadFolders, saveFolder } = useFolderStore();

  useEffect(() => {
    if (!initial) return;
    (async () => {
      const priv = await getSecret(`key:${initial.id}:private`).catch(() => null);
      const pub = await getSecret(`key:${initial.id}:public`).catch(() => null);
      const pass = await getSecret(`key:${initial.id}:passphrase`).catch(() => null);
      if (priv && !privateKeyDirty.current) setPrivateKey(priv);
      if (pub && !publicKeyDirty.current) setPublicKey(pub);
      if (pass && !passphraseDirty.current) setPassphrase(pass);
    })();
  }, [initial?.id]);

  useEffect(() => { void loadFolders(); }, [loadFolders]);

  const pinKey = useKeyStore((s) => s.pinKey);
  const effPinned = useEffectivePinned(initial ?? { id: "", pinned: false }, "key");
  const pinSource = useEffectivePinSource(initial ?? { id: "", pinned: false }, "key");
  const isPinned = effPinned;
  const isTeamVault = useTeamStore((s) => initial ? s.teams.some((t) => t.id === initial.vault_id) : false);
  const contributions = useUIContributions("key.panelActions", initial);
  const { toggleExcluded, isObjectSynced } = useSyncPrefsStore();
  const isSynced = initial ? isObjectSynced(initial.id, "key") : true;

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => onSubmit(
      { name: name.trim() || `${keyInfo.type ?? "SSH Key"} · ${new Date().toLocaleDateString()}`, key_type: keyInfo.type ?? undefined, tags, folder_id: folderId ?? undefined, vault_id: resolveVaultIdForSave(vaultId) },
      privateKeyDirty.current ? privateKey : null,
      publicKeyDirty.current ? publicKey : null,
      passphraseDirty.current ? passphrase : null,
    ) ?? undefined,
    canSave: () => !!privateKey.trim(),
  });
  const markDirty = useCallback(() => {
    if (isDirtyRef) isDirtyRef.current = true;
    _markDirty();
  }, [_markDirty, isDirtyRef]);

  if (flushRef) flushRef.current = flush;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, tags, privateKey, publicKey, passphrase, folderId, vaultId]);

  const handleClose = () => flushAndClose(onClose);

  return (
    <PanelShell>
      <PanelHeader
        icon={initial ? "lucide:pencil" : "lucide:plus"}
        title={initial ? "Edit Key" : "New Key"}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => { vaultPickerTouched.current = true; setVaultId(id); markDirty(); }} />}
        onClose={handleClose}
        saveState={saveState}
        actions={initial ? (() => {
          const items = [
            ...(onExport ? [{ label: "Add to host", icon: "lucide:square-arrow-right", onClick: () => onExport(initial) }] : []),
            ...contributions.map((a, i) => ({ ...a, icon: a.icon ?? "lucide:chevron-right", divider: i === 0 && !!onExport })),
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
                  pinKey(initial.id, !isPinned).catch(() => {});
                } else {
                  pinKey(initial.id, nextPersonalPinValue(pinSource)).catch(() => {});
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
            <label className={formLabelClass} style={formLabelStyle}>
              Label
            </label>
            <input
              className={formInputClass}
              style={formInputStyle}
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              placeholder={`${keyInfo.type ?? "SSH Key"} · ${new Date().toLocaleDateString()}`}
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

        <FormSection label="Key Material">
          <div>
            <label className={formLabelClass} style={formLabelStyle}>
              Private Key <span className="text-[var(--t-accent)]">*</span>
            </label>
            <textarea
              className={`${formInputClass} font-mono text-xs h-32 resize-none`}
              style={formInputStyle}
              value={privateKey}
              onChange={(e) => { markDirty(); privateKeyDirty.current = true; setPrivateKey(e.target.value); }}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
            />
            {privateKey.trim() && (
              <div className="flex items-center gap-1.5 mt-1.5">
                {keyInfo.valid && keyInfo.type ? (
                  <>
                    <Icon icon="lucide:check-circle" width={12} className="text-[var(--t-status-connected)]" />
                    <span className="text-xs text-[var(--t-status-connected)]">
                      {keyInfo.type}
                    </span>
                  </>
                ) : keyInfo.valid ? (
                  <>
                    <Icon icon="lucide:help-circle" width={12} className="text-[var(--t-text-dim)]" />
                    <span className="text-xs text-[var(--t-text-dim)]">Unknown type</span>
                  </>
                ) : (
                  <>
                    <Icon icon="lucide:x-circle" width={12} className="text-[var(--t-status-error)]" />
                    <span className="text-xs text-[var(--t-status-error)]">
                      {keyInfo.error ?? "Invalid key"}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>
              Passphrase <span className="text-[var(--t-text-dim)] font-normal">(optional)</span>
            </label>
            <div className="relative">
              <input
                type={showPassphrase ? "text" : "password"}
                className={`${formInputClass} pr-9`}
                style={formInputStyle}
                value={passphrase}
                onChange={(e) => { markDirty(); passphraseDirty.current = true; setPassphrase(e.target.value); }}
                placeholder="Key passphrase"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors text-[var(--t-text-dim)]"
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
                tabIndex={-1}
              >
                <Icon icon={showPassphrase ? "lucide:eye-off" : "lucide:eye"} width={14} />
              </button>
            </div>
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>
              Public Key <span className="text-[var(--t-text-dim)] font-normal">(optional)</span>
            </label>
            <textarea
              className={`${formInputClass} font-mono text-xs h-20 resize-none`}
              style={formInputStyle}
              value={publicKey}
              onChange={(e) => { markDirty(); publicKeyDirty.current = true; setPublicKey(e.target.value); }}
              placeholder="ssh-ed25519 AAAA..."
            />
          </div>
        </FormSection>

        <FormSection label="Import from File">
          <KeyFileDropZone
            onPrivateKey={(v) => { markDirty(); privateKeyDirty.current = true; setPrivateKey(v); }}
            onPublicKey={(v) => { markDirty(); publicKeyDirty.current = true; setPublicKey(v); }}
          />
        </FormSection>

        {initial && onExport && (
          <div
            className="rounded-xl overflow-hidden bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)]"
          >
            <div
              className="px-4 py-2 flex items-center gap-2 border-b border-b-[var(--t-bg-card-hover)]"
            >
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
                Key Export
              </span>
            </div>
            <div className="px-4 py-3">
              <button
                onClick={() => onExport(initial)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity bg-[var(--t-accent)] text-white relative overflow-hidden"
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <Icon icon="lucide:square-arrow-right" width={20} />
                Add to host
              </button>
            </div>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
