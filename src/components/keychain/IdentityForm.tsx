import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAutosave } from "@/hooks/useAutosave";
import { FieldError, useReportBlocked, useRequiredField, type MobileEditFormProps } from "@/components/shared/fieldValidation";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAuditClientEvent } from "@/services/auditReporter";
import { useKeyStore } from "@/stores/keyStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { usePermissions } from "@/hooks/usePermission";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import {
  SecretInput,
  TagsAndFolderFields,
  useVaultObjectFormShell,
} from "@/components/shared/vaultObjectForm";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { unlinkIdentityFromHost } from "@/services/keychainForm";
import { useStoredSecrets } from "@/hooks/useStoredSecrets";
import { StoredSecretsNote } from "@/components/shared/VaultUnavailableNote";
import { ReadOnlyFields, withEditAccess, type EditAccessProps } from "@/components/shared/editAccess";
import {
  PanelShell, PanelHeader, FormSection,
  formInputClass, formInputStyle, formLabelClass, formLabelStyle, formIdentifierProps,
} from "@/components/shared/Panel";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { PickerDivider, PickerOption, PickerTrigger } from "@/components/shared/pickerParts";
import { PinButton } from "@/components/shared/PinButton";
import { useIdentityStore } from "@/stores/identityStore";
import { KeyFileDropZone } from "./KeyForm";
import { PublicKeyField, isPublicKeyInvalid } from "./PublicKeyField";
import { useDerivedPublicKey } from "./useDerivedPublicKey";
import type { Connection, Identity, IdentityFormData } from "@/types";
import { buildKeychainMenuItems } from "@/utils/keychainMenuItems";
import { useVaultScopedItems } from "@/hooks/useVaultScopedItems";
import { PermissionsSection } from "@/components/permissions/PermissionsSection";
import { LinkedToSection } from "./LinkedToSection";

// ─────────────────────────────────────────────────────────────────

// Deliberately not shared with connections/KeySelector: that one picks between an
// inline key and the keychain and ends in a "manage in keychain" action, this one
// has a third "no key" state and none of the key-type badges. Unifying them would
// take more props than the two compositions cost lines.
function KeySelector({
  value, onChange, vaultId,
}: {
  value: string | null | "__inline__";
  onChange: (id: string | null) => void;
  vaultId: string;
}) {
  const { t } = useTranslation();
  const { keys: personalKeys, teamKeys } = useKeyStore();
  const keys = useVaultScopedItems(vaultId, personalKeys, teamKeys);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isInline = value === "__inline__";
  const selected = isInline ? null : (keys.find((k) => k.id === value) ?? null);

  return (
    <div>
      <PickerTrigger
        buttonRef={buttonRef}
        icon={isInline ? "lucide:file-key" : selected ? "lucide:key-round" : "lucide:minus"}
        label={isInline
          ? t("keychain.identityForm.newKeyInline")
          : selected ? (selected.name ?? t("keychain.identityForm.unnamedKey")) : t("keychain.identityForm.noKey")}
        filled={!!selected || isInline}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />

      <PickerSurface
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        title={t("connections.common.sshKey")}
      >
        <PickerOption
          icon="lucide:minus"
          label={t("keychain.identityForm.noKey")}
          active={value === null}
          onClick={() => { onChange(null); setOpen(false); }}
        />
        <PickerOption
          icon="lucide:file-key"
          label={t("keychain.identityForm.newKeyInline")}
          active={value === "__inline__"}
          onClick={() => { onChange("__inline__"); setOpen(false); }}
        />
        {keys.length > 0 && <PickerDivider />}
        {keys.map((k) => (
          <PickerOption
            key={k.id}
            icon="lucide:key-round"
            label={k.name ?? k.id}
            active={value === k.id}
            onClick={() => { onChange(k.id); setOpen(false); }}
          />
        ))}
      </PickerSurface>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// IdentityForm (side panel)
// ─────────────────────────────────────────────────────────────────

export interface IdentityFormProps extends MobileEditFormProps {
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
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  hideChrome?: boolean;
}

export const IdentityForm = withEditAccess("identity", (p: IdentityFormProps) => p.initial, IdentityFormEditor);

function IdentityFormEditor({ initial, onSubmit, onClose, onDelete, flushRef, isDirtyRef, vaults, onMoveToVault, onCopyToVault, hideChrome, revealErrors, onBlockedChange, readOnly }: IdentityFormProps & EditAccessProps) {
  const { t } = useTranslation();
  const { loadKeys } = useKeyStore();
  const { loadConnections, updateConnection } = useConnectionStore();
  const pinIdentity = useIdentityStore((s) => s.pinIdentity);
  const shell = useVaultObjectFormShell({ initial, folderType: "keychain", objectType: "identity", pin: pinIdentity });
  const { vaultId, pickVault, folderId, keepSavedOnCancel, isPinned, togglePin } = shell;
  const contributions = useUIContributions("identity.panelActions", initial);
  const { toggleExcluded, isObjectSynced } = useSyncPrefsStore();
  const isSynced = initial ? isObjectSynced(initial.id, "identity") : true;
  const [name, setName] = useState(initial?.name ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keyId, setKeyId] = useState<string | null | "__inline__">(initial?.key_id ?? null);
  const [inlineKeyLabel, setInlineKeyLabel] = useState("");
  const [inlinePrivKey, setInlinePrivKey] = useState("");
  const [inlinePublicKey, setInlinePublicKey] = useState("");
  const passwordDirty = useRef(false);

  const allConnections = useAllConnections();
  const linkedHosts = useMemo(
    () => (initial ? allConnections.filter((c) => c.identity_id === initial.id) : []),
    [allConnections, initial?.id],
  );
  const can = usePermissions();
  const canUnlink = (c: Connection) =>
    !!initial
    && can("EDIT_CONNECTIONS", c.vault_id ?? "personal", c.id)
    && can("VIEW_SECRETS", initial.vault_id, initial.id)
    && (!initial.key_id || can("VIEW_SECRETS", initial.vault_id, initial.key_id));
  const unlink = (c: Connection) => {
    if (!initial) return;
    unlinkIdentityFromHost(initial, c, updateConnection).catch((e: unknown) => {
      useNotificationStore.getState().addToast({
        source: APP_SOURCE,
        type: "toast",
        message: t("keychain.identityForm.unlinkFailed", { name: connectionDisplayName(c), error: String(e) }),
        severity: "error",
        duration: 6000,
      });
    });
  };

  const isInline = keyId === "__inline__";

  useEffect(() => {
    void loadKeys();
    void loadConnections();
  }, []);

  const storedSecrets = useStoredSecrets(
    initial?.id,
    vaultId,
    { password: initial ? `identity:${initial.id}:password` : null },
    (v) => {
      if (v.password && !passwordDirty.current) setPassword(v.password);
    },
  );

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState, blocked } = useAutosave({
    onSave: () => {
      const keyMaterial = isInline
        ? { label: inlineKeyLabel || undefined, privateKey: inlinePrivKey, publicKey: inlinePublicKey }
        : undefined;
      return keepSavedOnCancel(onSubmit(
        { name: name.trim() || undefined, username, key_id: isInline ? undefined : (keyId ?? undefined), tags, folder_id: folderId ?? undefined, vault_id: resolveVaultIdForSave(vaultId) },
        passwordDirty.current ? password : null,
        keyMaterial,
      ));
    },
    // Same rule as KeyForm: an inline public half that is not a key is never
    // persisted, and the inline error under the field says why.
    canSave: () =>
      !!username.trim()
      && (!isInline || (!!inlinePrivKey.trim() && !isPublicKeyInvalid(inlinePublicKey))),
    readOnly,
    flushOnUnmount: hideChrome,
  });
  const markDirty = useCallback(() => {
    if (isDirtyRef) isDirtyRef.current = true;
    _markDirty();
  }, [_markDirty, isDirtyRef]);

  if (flushRef) flushRef.current = flush;
  useReportBlocked(blocked, onBlockedChange);
  const usernameField = useRequiredField(username, { enabled: !!hideChrome, reveal: revealErrors });
  const inlineKeyField = useRequiredField(inlinePrivKey, { enabled: !!hideChrome && isInline, reveal: revealErrors });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, tags, username, password, keyId, folderId, vaultId, inlineKeyLabel, inlinePrivKey, inlinePublicKey]);

  useDerivedPublicKey({
    privateKey: inlinePrivKey,
    publicKey: inlinePublicKey,
    onDerived: (derived) => { markDirty(); setInlinePublicKey(derived); },
  });

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
      {!hideChrome && (
      <PanelHeader
        icon={initial ? "lucide:pencil" : "lucide:plus"}
        title={initial ? t("keychain.identityForm.titleEdit") : t("keychain.toolbar.newIdentity")}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => pickVault(id, markDirty)} disabled={readOnly} />}
        onClose={handleClose}
        saveState={saveState}
        actions={initial ? (() => {
          const items = buildKeychainMenuItems({
            t,
            contributions,
            vaults,
            canEdit: !readOnly,
            isSynced,
            onMoveToVault,
            onCopyToVault,
            onToggleSync: () => toggleExcluded(initial.id),
            onDelete: onDelete ? () => { onDelete(initial.id); onClose(); } : undefined,
          });
          return (
            <>
              <PinButton pinned={isPinned} onToggle={togglePin} />
              {items.length > 0 && <PanelActionsMenu items={items} />}
            </>
          );
        })() : undefined}
      />
      )}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <StoredSecretsNote state={storedSecrets} />
        <ReadOnlyFields readOnly={readOnly} className="space-y-3">
        <FormSection label={t("keychain.common.general")}>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("keychain.common.label")}</label>
            <input
              className={formInputClass}
              style={formInputStyle}
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              placeholder={t("keychain.identityForm.namePlaceholder")}
            />
          </div>
          <TagsAndFolderFields
            shell={shell}
            tPrefix="keychain.common"
            folderType="keychain"
            tags={tags}
            onChangeTags={setTags}
            markDirty={markDirty}
          />
        </FormSection>

        <FormSection label={t("keychain.identityForm.sectionCredentials")}>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>
              {t("keychain.common.username")} <span className="text-(--t-accent)">*</span>
            </label>
            <input
              className={formInputClass}
              style={formInputStyle}
              value={username}
              onChange={(e) => { markDirty(); setUsername(e.target.value); }}
              placeholder="root"
              {...formIdentifierProps}
              {...usernameField.fieldProps}
            />
            <FieldError show={usernameField.invalid} />
          </div>

          {storedSecrets !== "forbidden" && (
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("keychain.common.password")}</label>
            <SecretInput
              value={password}
              onChange={(v) => { markDirty(); passwordDirty.current = true; setPassword(v); }}
              placeholder="••••••••"
              show={showPassword}
              onToggleShow={handleTogglePassword}
            />
          </div>
          )}

          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("keychain.identityForm.sshKeyLabel")}</label>
            <KeySelector
              value={keyId}
              onChange={(v) => { markDirty(); setKeyId(v); setInlinePrivKey(""); setInlinePublicKey(""); setInlineKeyLabel(""); }}
              vaultId={vaultId}
            />
          </div>
        </FormSection>

        {isInline && (
          <FormSection label={t("keychain.identityForm.sectionNewKeyMaterial")}>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>{t("keychain.identityForm.keyLabel")}</label>
              <input
                className={formInputClass}
                style={formInputStyle}
                value={inlineKeyLabel}
                onChange={(e) => { markDirty(); setInlineKeyLabel(e.target.value); }}
                placeholder={t("keychain.identityForm.keyLabelPlaceholder")}
              />
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>
                {t("keychain.common.privateKey")} <span className="text-(--t-accent)">*</span>
              </label>
              <textarea
                className={`${formInputClass} font-mono text-xs h-28 resize-none`}
                style={formInputStyle}
                value={inlinePrivKey}
                onChange={(e) => { markDirty(); setInlinePrivKey(e.target.value); }}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                {...formIdentifierProps}
                {...inlineKeyField.fieldProps}
              />
              <FieldError show={inlineKeyField.invalid} />
            </div>
            <PublicKeyField
              value={inlinePublicKey}
              onChange={(v) => { markDirty(); setInlinePublicKey(v); }}
              heightClass="h-16"
            />
            <KeyFileDropZone
              onPrivateKey={(v) => { markDirty(); setInlinePrivKey(v); }}
              onPublicKey={(v) => { markDirty(); setInlinePublicKey(v); }}
            />
          </FormSection>
        )}
        </ReadOnlyFields>

        {initial && (
          <LinkedToSection
            hosts={linkedHosts}
            unlink={{ allowed: canUnlink, run: unlink }}
            onLeave={handleClose}
          />
        )}
        {initial && <PermissionsSection objectId={initial.id} vaultId={initial.vault_id} type="identity" />}
      </div>
    </PanelShell>
  );
}
