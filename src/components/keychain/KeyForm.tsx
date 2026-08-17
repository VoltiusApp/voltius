import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { useStoredSecrets } from "@/hooks/useStoredSecrets";
import { VaultUnavailableNote } from "@/components/shared/VaultUnavailableNote";
import {
  PanelShell, PanelHeader, FormSection,
  formInputClass, formInputStyle, formLabelClass, formLabelStyle,
} from "@/components/shared/Panel";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useKeyStore } from "@/stores/keyStore";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import {
  SecretInput,
  TagsAndFolderFields,
  useVaultObjectFormShell,
} from "@/components/shared/vaultObjectForm";
import { VaultPicker } from "@/components/shared/VaultPicker";
import type { SshKey, SshKeyFormData } from "@/types";
import { buildKeychainMenuItems } from "@/utils/keychainMenuItems";
import { detectKeyInfo } from "./keyDetection";
import { KeyFileDropZone } from "./KeyFileDropZone";
import { KeyGenFields } from "./KeyGenFields";
import { PublicKeyField, isPublicKeyInvalid } from "./PublicKeyField";

// Re-exported for back-compat (IdentityForm imports KeyFileDropZone from here).
export { KeyFileDropZone } from "./KeyFileDropZone";
export { detectKeyInfo, PUB_TYPE_MAP } from "./keyDetection";

type KeyFormMode = "import" | "generate";

function ModeToggle({ mode, onChange }: { mode: KeyFormMode; onChange: (m: KeyFormMode) => void }) {
  const { t } = useTranslation();
  const opts: { value: KeyFormMode; label: string; icon: string }[] = [
    { value: "import", label: t("keychain.keyForm.modeImport"), icon: "lucide:import" },
    { value: "generate", label: t("keychain.keyForm.modeGenerate"), icon: "lucide:sparkles" },
  ];
  return (
    <div className="relative grid grid-cols-2 gap-0.5 p-0.5 rounded-lg bg-(--t-bg-base) border border-(--t-border)">
      {opts.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="relative z-10 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: active ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "transparent",
              color: active ? "var(--t-accent)" : "var(--t-text-secondary)",
            }}
          >
            <Icon icon={opt.icon} width={14} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// KeyForm (side panel)
// ─────────────────────────────────────────────────────────────────

export interface KeyFormProps {
  initial?: SshKey;
  initialMode?: KeyFormMode;
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

export function KeyForm({ initial, initialMode, onSubmit, onClose, onExport, onDelete, flushRef, isDirtyRef, vaults, canEdit, onMoveToVault, onCopyToVault }: KeyFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(initial?.folder_id ?? null);
  const isNew = !initial;
  const [mode, setMode] = useState<KeyFormMode>(initial ? "import" : (initialMode ?? "import"));
  const keyInfo = useMemo(() => detectKeyInfo(privateKey, publicKey), [privateKey, publicKey]);
  const privateKeyDirty = useRef(false);
  const publicKeyDirty = useRef(false);
  const passphraseDirty = useRef(false);
  const pinKey = useKeyStore((s) => s.pinKey);
  const shell = useVaultObjectFormShell({ initial, folderType: "keychain", objectType: "key", pin: pinKey });
  const { vaultId, pickVault, isPinned, togglePin } = shell;

  const vaultUnavailable = useStoredSecrets(
    initial?.id,
    {
      privateKey: initial ? `key:${initial.id}:private` : null,
      publicKey: initial ? `key:${initial.id}:public` : null,
      passphrase: initial ? `key:${initial.id}:passphrase` : null,
    },
    (v) => {
      if (v.privateKey && !privateKeyDirty.current) setPrivateKey(v.privateKey);
      if (v.publicKey && !publicKeyDirty.current) setPublicKey(v.publicKey);
      if (v.passphrase && !passphraseDirty.current) setPassphrase(v.passphrase);
    },
  );

  const contributions = useUIContributions("key.panelActions", initial);
  const { toggleExcluded, isObjectSynced } = useSyncPrefsStore();
  const isSynced = initial ? isObjectSynced(initial.id, "key") : true;

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => onSubmit(
      // Default name kept in English — it can be persisted as the key's name (see i18n issue #14).
      { name: name.trim() || `${keyInfo.type ?? "SSH Key"} · ${new Date().toLocaleDateString()}`, key_type: keyInfo.type ?? undefined, tags, folder_id: folderId ?? undefined, vault_id: resolveVaultIdForSave(vaultId) },
      privateKeyDirty.current ? privateKey : null,
      publicKeyDirty.current ? publicKey : null,
      passphraseDirty.current ? passphrase : null,
    ) ?? undefined,
    // A public half that is not a key is never persisted: autosave holds until
    // the field is emptied or corrected, and the inline error says why.
    canSave: () => !!privateKey.trim() && !isPublicKeyInvalid(publicKey),
  });
  const markDirty = useCallback(() => {
    if (isDirtyRef) isDirtyRef.current = true;
    _markDirty();
  }, [_markDirty, isDirtyRef]);

  if (flushRef) flushRef.current = flush;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, tags, privateKey, publicKey, passphrase, folderId, vaultId]);

  const handleClose = () => flushAndClose(onClose);

  // Generated material flows in here; reveal it in the import view and let
  // autosave persist it like any other key.
  const handleGenerated = (priv: string, pub: string, pass: string) => {
    markDirty();
    privateKeyDirty.current = true;
    publicKeyDirty.current = true;
    passphraseDirty.current = true;
    setPrivateKey(priv);
    setPublicKey(pub);
    setPassphrase(pass);
    setMode("import");
  };

  return (
    <PanelShell>
      <PanelHeader
        icon={initial ? "lucide:pencil" : "lucide:plus"}
        title={initial ? t("keychain.keyForm.titleEdit") : t("keychain.toolbar.newKey")}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => pickVault(id, markDirty)} />}
        onClose={handleClose}
        saveState={saveState}
        actions={initial ? (() => {
          const items = buildKeychainMenuItems({
            t,
            contributions,
            vaults,
            canEdit,
            isSynced,
            onMoveToVault,
            onCopyToVault,
            onToggleSync: () => toggleExcluded(initial.id),
            onDelete: onDelete ? () => { onDelete(initial.id); onClose(); } : undefined,
            leading: onExport ? [{ label: t("keychain.common.addToHost"), icon: "lucide:square-arrow-right", onClick: () => onExport(initial) }] : [],
          });
          return (
            <>
              <PinButton pinned={isPinned} onToggle={togglePin} />
              {items.length > 0 && <PanelActionsMenu items={items} />}
            </>
          );
        })() : undefined}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {vaultUnavailable && <VaultUnavailableNote />}
        <FormSection label={t("keychain.common.general")}>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>
              {t("keychain.common.label")}
            </label>
            <input
              className={formInputClass}
              style={formInputStyle}
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              // Matches the persisted default name fallback above — kept in English (see i18n issue #14).
              placeholder={`${keyInfo.type ?? "SSH Key"} · ${new Date().toLocaleDateString()}`}
            />
          </div>
          <TagsAndFolderFields
            shell={shell}
            tPrefix="keychain.common"
            folderType="keychain"
            tags={tags}
            onChangeTags={setTags}
            folderId={folderId}
            onChangeFolderId={setFolderId}
            markDirty={markDirty}
          />
        </FormSection>

        {isNew && <ModeToggle mode={mode} onChange={setMode} />}

        {mode === "generate" ? (
          <KeyGenFields onGenerated={handleGenerated} />
        ) : (<>
          <FormSection label={t("keychain.keyForm.sectionKeyMaterial")}>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>
                {t("keychain.common.privateKey")} <span className="text-(--t-accent)">*</span>
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
                      <Icon icon="lucide:circle-check-big" width={12} className="text-(--t-status-connected)" />
                      <span className="text-xs text-(--t-status-connected)">
                        {keyInfo.type}
                      </span>
                    </>
                  ) : keyInfo.valid ? (
                    <>
                      <Icon icon="lucide:circle-question-mark" width={12} className="text-(--t-text-dim)" />
                      <span className="text-xs text-(--t-text-dim)">{t("keychain.keyForm.unknownType")}</span>
                    </>
                  ) : (
                    <>
                      <Icon icon="lucide:circle-x" width={12} className="text-(--t-status-error)" />
                      <span className="text-xs text-(--t-status-error)">
                        {keyInfo.error ?? t("keychain.keyForm.invalidKey")}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>
                {t("keychain.common.passphrase")} <span className="text-(--t-text-dim) font-normal">{t("keychain.common.optional")}</span>
              </label>
              <SecretInput
                value={passphrase}
                onChange={(v) => { markDirty(); passphraseDirty.current = true; setPassphrase(v); }}
                placeholder={t("keychain.keyForm.keyPassphrasePlaceholder")}
                show={showPassphrase}
                onToggleShow={() => setShowPassphrase((v) => !v)}
                autoComplete="new-password"
              />
            </div>
            <PublicKeyField
              value={publicKey}
              onChange={(v) => { markDirty(); publicKeyDirty.current = true; setPublicKey(v); }}
              heightClass="h-20"
            />
          </FormSection>

          <FormSection label={t("keychain.keyForm.sectionImportFromFile")}>
            <KeyFileDropZone
              onPrivateKey={(v) => { markDirty(); privateKeyDirty.current = true; setPrivateKey(v); }}
              onPublicKey={(v) => { markDirty(); publicKeyDirty.current = true; setPublicKey(v); }}
            />
          </FormSection>
        </>)}

        {initial && onExport && (
          <div
            className="rounded-xl overflow-hidden bg-(--t-bg-card) border border-(--t-bg-card-hover)"
          >
            <div
              className="px-4 py-2 flex items-center gap-2 border-b border-b-(--t-bg-card-hover)"
            >
              <span className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
                {t("keychain.keyForm.sectionKeyExport")}
              </span>
            </div>
            <div className="px-4 py-3">
              <button
                onClick={() => onExport(initial)}
                className="btn btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium relative overflow-hidden"
              >
                <Icon icon="lucide:square-arrow-right" width={20} />
                {t("keychain.common.addToHost")}
              </button>
            </div>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
