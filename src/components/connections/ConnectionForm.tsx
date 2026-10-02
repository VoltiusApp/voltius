import { forwardRef, type RefAttributes, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { ConnectionFormData, AuthType, JumpHost, EnvVar, ProxyOverride, ConnectionType } from "@/types";
import { parseWebdavUrl } from "@/utils/connectionType";
import { KEEPALIVE_PRESETS, type KeepalivePreset } from "@/utils/keepalive";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import JumpHostsPanel from "./JumpHostsPanel";
import EnvVarsPanel from "./EnvVarsPanel";
import { useUIStore } from "@/stores/uiStore";
import { getSecret } from "@/services/vault";
import { sshExecCommand } from "@/services/ssh";
import { isCustomProxyMode, resolveProxy } from "@/services/proxy";
import { useStoredSecrets } from "@/hooks/useStoredSecrets";
import { StoredSecretsNote } from "@/components/shared/VaultUnavailableNote";
import { useAutosave } from "@/hooks/useAutosave";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAuditClientEvent } from "@/services/auditReporter";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import IdentitySelector from "./IdentitySelector";
import KeySelector from "./KeySelector";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useConnectionStore } from "@/stores/connectionStore";
import { buildConnectionMenuItems } from "@/utils/connectionMenuItems";
import { useCanConnect } from "@/hooks/useCanConnect";
import { useConnectAsMenuItem } from "@/hooks/useConnectAsMenuItem";
import { NO_CONNECTION, useCredentialPlan } from "@/hooks/useCredentialPlan";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";
import { useToggle } from "@/stores/toggleSettingsStore";
import { HOST_PROXY_MODES, useGlobalKeepalivePreset, useGlobalProxy } from "@/stores/connectivitySettingsStore";
import { proxyPasswordKey } from "@/services/teamVaultSecretKeys";
import ProxyFields from "./ProxyFields";
import { useVaultScopedItems } from "@/hooks/useVaultScopedItems";
import { getConnectionIcon, getConnectionIconColor, getConnectionIconLabel, glossyTileStyle, normalizeDistro } from "@/utils/icons";
import { DistroIconPicker } from "./DistroIconPicker";
import { PermissionsSection } from "@/components/permissions/PermissionsSection";
import { ReadOnlyFields, withEditAccess, type EditAccessProps } from "@/components/shared/editAccess";
import {
  PanelShell,
  PanelHeader,
  FormSection,
  formInputClass,
  formInputStyle,
  formLabelClass,
  formLabelStyle,
  formIdentifierProps,
} from "@/components/shared/Panel";
import { YouConnectAsRow } from "./YouConnectAsRow";
import { SecretInput, TagsAndFolderFields } from "@/components/shared/vaultObjectForm";
import { normalizeNotes } from "@/components/notes/notesText";
import {
  AdvancedDisclosure,
  SettingRow,
  HostCommandFields,
  NotesSection,
  hostCommandFieldsSet,
  useHostCommandFields,
  useConnectionFormShell,
  type ConnectionFormHandle,
  type ConnectionFormProps,
} from "./formShared";

type Props = ConnectionFormProps & {
  /** Mobile embed: hide the desktop PanelHeader (close, actions) and the
   *  VaultPicker subheader so the mobile screen owns the single header + Save.
   *  Desktop default is undefined → unchanged behavior. */
  hideChrome?: boolean;
};

type Protocol = "ssh" | "ftp" | "webdav";
const DEFAULT_PORT: Record<Exclude<Protocol, "webdav">, number> = { ssh: 22, ftp: 21 };
const DEFAULT_USERNAME: Record<Protocol, string> = { ssh: "root", ftp: "", webdav: "" };
const initialProtocol = (type?: ConnectionType): Protocol => (type === "ftp" || type === "webdav" ? type : "ssh");

const ConnectionFormEditor = forwardRef<ConnectionFormHandle, Props & EditAccessProps>(function ConnectionFormEditor({ initial, onSubmit, onClose, onDuplicate, onConnect, onDelete, vaults, hideChrome, onMoveToVault, onCopyToVault, readOnly }, ref) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState<number | "">(initial?.port ?? 22);
  const [protocol, setProtocol] = useState<Protocol>(initialProtocol(initial?.connection_type));
  const [username, setUsername] = useState(initial?.username ?? DEFAULT_USERNAME[protocol]);
  const [ftpSecure, setFtpSecure] = useState(initial?.ftp_secure ?? false);
  const [webdavUrl, setWebdavUrl] = useState(initial?.webdav_url ?? "");
  const isFtp = protocol === "ftp";
  const isWebdav = protocol === "webdav";
  const fileOnly = protocol !== "ssh";
  const webdavTarget = isWebdav ? parseWebdavUrl(webdavUrl) : null;
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [identityId, setIdentityId] = useState<string | null>(initial?.identity_id ?? null);
  const [keyId, setKeyId] = useState<string | null>(initial?.key_id ?? null);
  const [jumpHosts, setJumpHosts] = useState<JumpHost[]>(initial?.jump_hosts ?? []);
  const [showChaining, setShowChaining] = useState(false);
  const [envVars, setEnvVars] = useState<EnvVar[]>(initial?.env_vars ?? []);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [agentForwarding, setAgentForwarding] = useState(initial?.agent_forwarding ?? false);
  const [legacyAlgorithms, setLegacyAlgorithms] = useState(initial?.legacy_algorithms ?? false);
  const [pingDisabled, setPingDisabled] = useState(initial?.ping_disabled ?? false);
  const [shellIntegration, setShellIntegration] = useState<"" | "on" | "off">(
    initial?.shell_integration === undefined ? "" : initial.shell_integration ? "on" : "off",
  );
  const [globalShellIntegration] = useToggle("shell-integration");
  const [globalKeepalive] = useGlobalKeepalivePreset();
  const [globalPersist] = useToggle("persistent-sessions");
  const [globalProxy] = useGlobalProxy();
  const [proxyOverride, setProxyOverride] = useState<ProxyOverride | null>(initial?.proxy ?? null);
  const [proxyPassword, setProxyPassword] = useState("");
  const [proxyPasswordSaved, setProxyPasswordSaved] = useState(false);
  const hostCommands = useHostCommandFields(initial);
  const [keepalivePreset, setKeepalivePreset] = useState<KeepalivePreset | "">(initial?.keepalive_preset ?? "");
  const [persistSession, setPersistSession] = useState<"" | "on" | "off">(
    initial?.persist_session === undefined ? "" : initial.persist_session ? "on" : "off",
  );
  const [distro, setDistro] = useState(initial?.distro ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [showDistroPicker, setShowDistroPicker] = useState(false);
  const [detectingDistro, setDetectingDistro] = useState(false);
  const [distroError, setDistroError] = useState("");
  const hasAdvanced = !!(initial?.jump_hosts?.length || initial?.env_vars?.length || initial?.pre_command || initial?.post_command || initial?.pre_snippet_id || initial?.post_snippet_id || initial?.terminal_encoding || initial?.agent_forwarding || initial?.legacy_algorithms || initial?.ping_disabled || initial?.shell_integration !== undefined || initial?.keepalive_preset || initial?.persist_session !== undefined || initial?.proxy);
  const [showAdvanced, setShowAdvanced] = useState(hasAdvanced);
  const shell = useConnectionFormShell(initial);
  const { vaultId, pickVault, folderId, keepSavedOnCancel, isPinned, togglePin } = shell;
  const userEditedRef = useRef(false);
  const prevVaultIdRef = useRef(vaultId);
  const passwordDirty = useRef(false);
  const privateKeyDirty = useRef(false);
  const passphraseDirty = useRef(false);
  const proxyPasswordDirty = useRef(false);
  // Anchor the icon picker to the whole tile+label row so the desktop float matches the
  // row width (as the old inline picker did) instead of overflowing from the 40px tile.
  const iconRowRef = useRef<HTMLDivElement>(null);

  const { identities, teamIdentities, loadIdentities } = useIdentityStore();
  const { keys, teamKeys, loadKeys } = useKeyStore();
  const relevantIdentities = useVaultScopedItems(vaultId, identities, teamIdentities);
  const relevantKeys = useVaultScopedItems(vaultId, keys, teamKeys);
  useEffect(() => {
    if (prevVaultIdRef.current !== vaultId) {
      prevVaultIdRef.current = vaultId;
      setIdentityId(null);
      setKeyId(null);
    }
  }, [vaultId]);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const setConnectionDistro = useConnectionStore((s) => s.setDistro);
  const contributions = useUIContributions("connection.panelActions", initial);
  const { toggleExcluded, isObjectSynced } = useSyncPrefsStore();
  const isSynced = initial ? isObjectSynced(initial.id, "connection") : true;

  useEffect(() => {
    void loadIdentities();
    void loadKeys();
  }, [loadIdentities, loadKeys]);


  // Load existing secrets when editing
  const storedSecrets = useStoredSecrets(
    initial?.id,
    vaultId,
    {
      password: initial ? `password:${initial.id}` : null,
      privateKey: initial && !initial.key_id ? `key:${initial.id}` : null,
      passphrase: initial && !initial.key_id ? `passphrase:${initial.id}` : null,
    },
    (v) => {
      if (v.password && !passwordDirty.current) setPassword(v.password);
      if (v.privateKey && !privateKeyDirty.current) setPrivateKey(v.privateKey);
      if (v.passphrase && !passphraseDirty.current) setPassphrase(v.passphrase);
    },
  );

  const secretsHidden = storedSecrets === "forbidden";

  const initialId = initial?.id;
  const initialProxyHasPassword = isCustomProxyMode(initial?.proxy?.mode);
  useEffect(() => {
    if (!initialId || !initialProxyHasPassword) return;
    getSecret(proxyPasswordKey(initialId)).then((v) => setProxyPasswordSaved(!!v)).catch(() => {});
  }, [initialId, initialProxyHasPassword]);

  const selectedIdentity = relevantIdentities.find((i) => i.id === identityId) ?? null;

  const buildSubmit = () => {
    if (fileOnly) {
      return {
        data: {
          name: name.trim() || undefined,
          host: webdavTarget?.host ?? host,
          port: webdavTarget?.port ?? (port || DEFAULT_PORT.ftp),
          username,
          auth_type: "password",
          tags,
          folder_id: folderId ?? undefined,
          vault_id: resolveVaultIdForSave(vaultId),
          icon: icon || undefined,
          connection_type: protocol,
          ...(isFtp ? { ftp_secure: ftpSecure } : { webdav_url: webdavTarget?.url, proxy: proxyOverride ?? undefined }),
          notes: normalizeNotes(notes),
        } as ConnectionFormData,
        secrets: {
          password: passwordDirty.current ? password : null,
          privateKey: null,
          passphrase: null,
          proxyPassword: isWebdav && proxyPasswordDirty.current ? proxyPassword : null,
        },
      };
    }
    let submitUsername = username;
    let submitAuthType: AuthType = (keyId || privateKey.trim()) ? "key" : "password";
    if (identityId && selectedIdentity) {
      submitUsername = selectedIdentity.username;
      submitAuthType = selectedIdentity.key_id ? "key" : "password";
    }
    return {
      data: {
        name: name.trim() || undefined,
        host,
        port: port || 22,
        username: submitUsername,
        auth_type: submitAuthType,
        tags,
        identity_id: identityId ?? undefined,
        key_id: !identityId ? (keyId ?? undefined) : undefined,
        folder_id: folderId ?? undefined,
        vault_id: resolveVaultIdForSave(vaultId),
        jump_hosts: jumpHosts.length > 0 ? jumpHosts : undefined,
        env_vars: envVars.length > 0 ? envVars : undefined,
        agent_forwarding: agentForwarding,
        legacy_algorithms: legacyAlgorithms,
        pre_command: hostCommands.preCommand.trim() || undefined,
        post_command: hostCommands.postCommand.trim() || undefined,
        pre_snippet_id: hostCommands.preSnippetId,
        post_snippet_id: hostCommands.postSnippetId,
        ask_vars_each_time: hostCommands.askVarsEachTime,
        terminal_encoding: hostCommands.terminalEncoding || undefined,
        distro: distro || undefined,
        icon: icon || undefined,
        ping_disabled: pingDisabled || undefined,
        shell_integration: shellIntegration === "" ? undefined : shellIntegration === "on",
        keepalive_preset: keepalivePreset || undefined,
        persist_session: persistSession === "" ? undefined : persistSession === "on",
        proxy: proxyOverride ?? undefined,
        notes: normalizeNotes(notes),
      } as ConnectionFormData,
      secrets: {
        password: passwordDirty.current ? password : null,
        privateKey: (!identityId && !keyId && privateKeyDirty.current) ? privateKey : null,
        passphrase: (!identityId && !keyId && passphraseDirty.current) ? passphrase : null,
        proxyPassword: proxyPasswordDirty.current ? proxyPassword : null,
      },
    };
  };

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => { const { data, secrets } = buildSubmit(); return keepSavedOnCancel(onSubmit(data, secrets)); },
    canSave: () => (isWebdav ? !!webdavTarget : !!host.trim() && (port === "" || (port >= 1 && port <= 65535))),
    readOnly,
  });
  const markDirty = useCallback(() => { userEditedRef.current = true; _markDirty(); }, [_markDirty]);


  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, host, port, username, protocol, ftpSecure, webdavUrl, password, privateKey, passphrase, identityId, keyId, folderId, tags, vaultId, jumpHosts, envVars, agentForwarding, legacyAlgorithms, hostCommands.preCommand, hostCommands.postCommand, hostCommands.preSnippetId, hostCommands.postSnippetId, hostCommands.askVarsEachTime, hostCommands.terminalEncoding, distro, icon, pingDisabled, shellIntegration, keepalivePreset, persistSession, proxyOverride, proxyPassword, notes]);

  useImperativeHandle(ref, () => ({ flush, isDirty: () => userEditedRef.current }), [flush]);

  const handleClose = () => flushAndClose(onClose);

  const handleTogglePassword = useCallback(() => {
    if (!showPassword && initial && password) {
      reportAuditClientEvent(auditContextForVaultId(vaultId), "secret.viewed", {
        target_type: "connection",
        target_id: initial.id,
        target_name: initial.name?.trim() || initial.host,
        metadata: { kind: "password" },
      });
    }
    setShowPassword((v) => !v);
  }, [showPassword, initial, password, vaultId]);

  const visibleIcon = icon || distro;

  const keepaliveOptions = useMemo(() => [
    { value: "", label: t("connections.form.inheritKeepalive", { label: t(KEEPALIVE_PRESETS[globalKeepalive].labelKey) }) },
    ...(Object.keys(KEEPALIVE_PRESETS) as KeepalivePreset[]).map((p) => ({ value: p, label: t(KEEPALIVE_PRESETS[p].labelKey) })),
  ], [globalKeepalive, t]);

  const shellIntegrationOptions = useMemo(() => [
    { value: "", label: t("connections.form.inheritShellIntegration", { state: globalShellIntegration ? t("connections.common.on") : t("connections.common.off") }) },
    { value: "on", label: t("connections.common.on") },
    { value: "off", label: t("connections.common.off") },
  ], [globalShellIntegration, t]);

  const persistOptions = useMemo(() => [
    { value: "", label: t("connections.form.inheritPersist", { state: globalPersist ? t("connections.common.on") : t("connections.common.off") }) },
    { value: "on", label: t("connections.common.on") },
    { value: "off", label: t("connections.common.off") },
  ], [globalPersist, t]);

  const proxyModes = useMemo(() => [
    { value: "", label: t("connections.form.proxy.inherit", { label: t(`settings.hosts.proxy.modes.${globalProxy.mode}`) }) },
    ...HOST_PROXY_MODES.map((m) => ({ value: m, label: t(`connections.form.proxy.modes.${m}`) })),
  ], [globalProxy.mode, t]);

  const applyIcon = useCallback((nextIcon: string) => {
    setIcon(nextIcon);
    setDistroError("");
    markDirty();
  }, [markDirty]);

  const applyDetectedDistro = useCallback((nextDistro: string) => {
    const normalized = normalizeDistro(nextDistro);
    setDistro(normalized);
    setIcon(normalized);
    setDistroError("");
    markDirty();
    if (initial) {
      void setConnectionDistro(initial.id, normalized).catch((err) => setDistroError(String(err)));
    }
  }, [initial, markDirty, setConnectionDistro]);

  const detectDistroFromForm = useCallback(async () => {
    if (!host.trim()) return;
    setDetectingDistro(true);
    setDistroError("");
    try {
      let detectUsername = username;
      let detectPassword = password || undefined;
      let detectPrivateKey = privateKey || undefined;
      let detectPassphrase = passphrase || undefined;

      if (identityId && selectedIdentity) {
        detectUsername = selectedIdentity.username;
        detectPassword = (await getSecret(`identity:${identityId}:password`).catch(() => null)) ?? undefined;
        detectPrivateKey = selectedIdentity.key_id
          ? (await getSecret(`key:${selectedIdentity.key_id}:private`).catch(() => null)) ?? undefined
          : undefined;
        detectPassphrase = undefined;
      } else if (keyId) {
        detectPrivateKey = (await getSecret(`key:${keyId}:private`).catch(() => null)) ?? undefined;
        detectPassphrase = undefined;
        if (initial) {
          detectPassword = passwordDirty.current ? (password || undefined) : ((await getSecret(`password:${initial.id}`).catch(() => null)) ?? undefined);
        } else {
          detectPassword = password || undefined;
        }
      } else if (initial) {
        detectPassword = passwordDirty.current ? (password || undefined) : ((await getSecret(`password:${initial.id}`).catch(() => null)) ?? undefined);
        detectPrivateKey = privateKeyDirty.current ? (privateKey || undefined) : ((await getSecret(`key:${initial.id}`).catch(() => null)) ?? undefined);
        detectPassphrase = passphraseDirty.current ? (passphrase || undefined) : ((await getSecret(`passphrase:${initial.id}`).catch(() => null)) ?? undefined);
      }

      const { stdout } = await sshExecCommand({
        host: host.trim(),
        port: port || 22,
        username: detectUsername.trim(),
        password: detectPassword,
        privateKey: detectPrivateKey,
        passphrase: detectPassphrase,
        legacyAlgorithms,
        command: "{ cat /etc/os-release 2>/dev/null || echo ID=linux; }; test -d /etc/pve && echo 'PROXMOX_VE=1'; test -d /etc/proxmox-backup && echo 'PBS_DETECTED=1'; true",
        proxy: await resolveProxy(
          { id: initial?.id ?? "", proxy: initial?.proxy },
          { proxy: proxyOverride, password: proxyPasswordDirty.current ? proxyPassword || undefined : undefined },
        ),
      });
      const lines = stdout.split(/\r?\n/);
      const idLine = lines.find((line) => line.startsWith("ID="));
      const rawId = idLine?.slice(3).trim().replace(/^"|"$/g, "") || "linux";
      const isProxmox = lines.some((line) => line.trim() === "PROXMOX_VE=1");
      const isPbs = lines.some((line) => line.trim() === "PBS_DETECTED=1");
      const detected = isProxmox ? "proxmox" : isPbs ? "pbs" : normalizeDistro(rawId);
      applyDetectedDistro(detected);
    } catch (err) {
      setDistroError(String(err));
    } finally {
      setDetectingDistro(false);
    }
  }, [applyDetectedDistro, host, identityId, keyId, initial, legacyAlgorithms, passphrase, password, port, privateKey, proxyOverride, proxyPassword, selectedIdentity, username]);

  const canConnect = useCanConnect({ id: initial?.id ?? "", vault_id: initial?.vault_id ?? "" });
  const credential = useCredentialPlan(initial ?? NO_CONNECTION);
  const isTeamHost = !!initial && !!credential.teamId;
  const connectAs = useConnectAsMenuItem(initial, credential, () => onConnect?.());
  const panelItems = initial ? buildConnectionMenuItems({
    t,
    canEdit: !readOnly,
    contributions,
    vaults,
    isSynced,
    pingDisabled,
    onConnect: canConnect ? () => onConnect?.() : undefined,
    connectAs,
    onDuplicate: () => onDuplicate?.(),
    onMoveToVault,
    onCopyToVault,
    onToggleSync: () => toggleExcluded(initial.id),
    onTogglePing: () => { markDirty(); setPingDisabled((v) => !v); },
    onDelete: onDelete ? () => onDelete() : undefined,
  }) : [];

  const proxyFields = (
  <ProxyFields
    modes={proxyModes}
    value={proxyOverride ?? { mode: "" }}
    onChange={(p) => { markDirty(); setProxyOverride(p.mode ? (p as ProxyOverride) : null); }}
    password={proxyPassword}
    passwordSaved={proxyPasswordSaved}
    onPasswordChange={(pw) => { markDirty(); proxyPasswordDirty.current = true; setProxyPassword(pw); }}
    disabled={readOnly}
    className="pb-1"
    renderRow={(select) => (
      <SettingRow icon="lucide:globe" label={t("connections.form.proxy.label")}>{select}</SettingRow>
    )}
  />
  );

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
    <PanelShell>
      {!hideChrome && (
        <PanelHeader
          icon={initial ? "lucide:pencil" : "lucide:plus"}
          title={initial ? t("connections.form.titleEdit") : t("connections.form.titleNew")}
          subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => pickVault(id, markDirty)} disabled={readOnly} />}
          onClose={handleClose}
          saveState={initial ? saveState : undefined}
          actions={initial ? (
            <>
              <PinButton pinned={isPinned} onToggle={togglePin} />
              {panelItems.length > 0 && <PanelActionsMenu items={panelItems} />}
            </>
          ) : undefined}
        />
      )}

      <div className="flex flex-col flex-1 overflow-y-auto">
        <div className="flex-1 px-4 py-4 space-y-3">

          <StoredSecretsNote state={storedSecrets} />

          <ReadOnlyFields readOnly={readOnly} className="space-y-3">
          <FormSection label={t("connections.common.general")}>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.labelField")}</label>
              <div ref={iconRowRef} className="relative flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowDistroPicker((v) => !v)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 transition-all hover:brightness-110"
                  style={glossyTileStyle(visibleIcon ? getConnectionIconColor(visibleIcon) : "var(--t-bg-card-avatar)")}
                  title={visibleIcon ? t("connections.form.changeIconWithLabel", { label: getConnectionIconLabel(visibleIcon) }) : t("connections.form.changeIcon")}
                  aria-label={t("connections.form.changeIconAriaLabel")}
                >
                  <Icon icon={visibleIcon ? getConnectionIcon(visibleIcon) : "lucide:server"} width={18} />
                </button>
                <input
                  className={formInputClass}
                  style={formInputStyle}
                  value={name}
                  onChange={(e) => { markDirty(); setName(e.target.value); }}
                  placeholder={t("connections.form.namePlaceholder")}
                />
                <DistroIconPicker
                  open={showDistroPicker}
                  onClose={() => setShowDistroPicker(false)}
                  anchorRef={iconRowRef}
                  selectedIcon={visibleIcon}
                  onPick={(id) => { applyIcon(id); }}
                  detectingDistro={detectingDistro}
                  distroError={distroError}
                  onDetectDistro={() => void detectDistroFromForm()}
                  canDetect={!!(host.trim() && username.trim())}
                />
              </div>
            </div>
            <TagsAndFolderFields
              shell={shell}
              tPrefix="connections.common"
              folderType="connection"
              tags={tags}
              onChangeTags={setTags}
              markDirty={markDirty}
            />
          </FormSection>

          <FormSection label={t("connections.form.sectionConnection")}>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>{t("connections.form.protocol")}</label>
              <FormSelect
                value={protocol}
                options={[
                  { value: "ssh", label: t("connections.form.protocolSsh") },
                  { value: "ftp", label: t("connections.form.protocolFtp") },
                  { value: "webdav", label: t("connections.form.protocolWebdav") },
                ]}
                onChange={(v) => {
                  markDirty();
                  const next = v as Protocol;
                  setProtocol(next);
                  setUsername((u) => (u === DEFAULT_USERNAME[protocol] ? DEFAULT_USERNAME[next] : u));
                  if (next !== "webdav") {
                    setPort((p) => (isWebdav || p === "" || Object.values(DEFAULT_PORT).includes(p) ? DEFAULT_PORT[next] : p));
                  }
                }}
              />
            </div>
            {isWebdav ? (
              <div>
                <label className={formLabelClass} style={formLabelStyle}>{t("connections.form.webdavUrl")} <span className="text-(--t-accent)">*</span></label>
                <input
                  className={formInputClass}
                  style={formInputStyle}
                  value={webdavUrl}
                  onChange={(e) => { markDirty(); setWebdavUrl(e.target.value); }}
                  placeholder={t("connections.form.webdavUrlPlaceholder")}
                  {...formIdentifierProps}
                />
                {webdavUrl.trim() !== "" && !webdavTarget && (
                  <p className="mt-1 text-xs text-(--t-status-error)" data-webdav-url-error>{t("connections.form.webdavUrlInvalid")}</p>
                )}
                {webdavTarget && !webdavTarget.secure && (
                  <p className="mt-1 text-xs text-(--t-status-warning)" data-webdav-plaintext>{t("connections.form.webdavPlaintextWarning")}</p>
                )}
              </div>
            ) : (
              <div className="flex gap-2.5">
                <div className="flex-1">
                  <label className={formLabelClass} style={formLabelStyle}>{t("connections.form.hostIp")} <span className="text-(--t-accent)">*</span></label>
                  <input
                    className={formInputClass}
                    style={formInputStyle}
                    value={host}
                    onChange={(e) => { markDirty(); setHost(e.target.value); }}
                    placeholder={t("connections.form.hostPlaceholder")}
                  />
                </div>
                <div className="w-20">
                  <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.port")} <span className="text-(--t-accent)">*</span></label>
                  <input
                    className={formInputClass}
                    style={{ ...formInputStyle, MozAppearance: "textfield" }}
                    value={port}
                    placeholder="22"
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      markDirty();
                      setPort(raw === "" ? "" : Math.min(65535, Math.max(1, Number(raw))));
                    }}
                  />
                </div>
              </div>
            )}
            {isWebdav && proxyFields}
            {!fileOnly && (<>
            <AdvancedDisclosure
              open={showAdvanced}
              onToggle={() => setShowAdvanced((v) => !v)}
              hasValues={!!(jumpHosts.length > 0 || envVars.length > 0 || hostCommandFieldsSet(hostCommands) || agentForwarding || legacyAlgorithms || pingDisabled || shellIntegration || keepalivePreset || persistSession || proxyOverride)}
            >
                <button
                  type="button"
                  onClick={() => setShowChaining(true)}
                  className="flex items-center gap-1.5 text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors w-full py-1"
                >
                  <Icon icon="lucide:waypoints" width={13} />
                  <span>{t("connections.common.hostsChaining")}</span>
                  {jumpHosts.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-(--t-accent) text-(--t-bg-card) text-[10px] font-bold leading-none">
                      {jumpHosts.length}
                    </span>
                  )}
                  <Icon icon="lucide:chevron-right" width={12} className="ml-auto" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnvVars(true)}
                  className="flex items-center gap-1.5 text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors w-full py-1"
                >
                  <Icon icon="lucide:file-terminal" width={13} />
                  <span>{t("connections.common.environmentVariables")}</span>
                  {envVars.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-(--t-accent) text-(--t-bg-card) text-[10px] font-bold leading-none">
                      {envVars.length}
                    </span>
                  )}
                  <Icon icon="lucide:chevron-right" width={12} className="ml-auto" />
                </button>
                <HostCommandFields connectionId={initial?.id} fields={hostCommands} markDirty={markDirty} />
                <SettingRow icon="lucide:key-round" label={t("connections.form.agentForwarding")}>
                  <Toggle checked={agentForwarding} onChange={(v) => { markDirty(); setAgentForwarding(v); }} />
                </SettingRow>
                <SettingRow
                  icon="lucide:shield-alert"
                  label={t("connections.form.legacyAlgorithms")}
                  title={t("connections.form.legacyAlgorithmsTooltip")}
                >
                  <Toggle checked={legacyAlgorithms} onChange={(v) => { markDirty(); setLegacyAlgorithms(v); }} />
                </SettingRow>
                <SettingRow icon="lucide:terminal" label={t("connections.form.shellIntegration")}>
                  <FormSelect
                    className="w-36"
                    value={shellIntegration}
                    options={shellIntegrationOptions}
                    onChange={(v) => { markDirty(); setShellIntegration(v as "" | "on" | "off"); }}
                  />
                </SettingRow>
                <SettingRow icon="lucide:heart-pulse" label={t("connections.form.keepalive")}>
                  <FormSelect
                    className="w-36"
                    value={keepalivePreset}
                    options={keepaliveOptions}
                    onChange={(v) => { markDirty(); setKeepalivePreset(v as KeepalivePreset | ""); }}
                  />
                </SettingRow>
                {proxyFields}
                <SettingRow icon="lucide:layers" label={t("connections.form.persistentSession")}>
                  <FormSelect
                    className="w-36"
                    value={persistSession}
                    options={persistOptions}
                    onChange={(v) => { markDirty(); setPersistSession(v as "" | "on" | "off"); }}
                  />
                </SettingRow>

            </AdvancedDisclosure>
            </>)}
          </FormSection>

          <FormSection label={fileOnly ? t("connections.form.sectionCredentials") : t("connections.form.sectionIdentity")}>
            {!fileOnly && (
            <div>
              <label className={formLabelClass} style={formLabelStyle}>{t("connections.form.keychainIdentity")}{isTeamHost && <span className="font-normal text-(--t-text-dim)"> · {t("connections.form.sharedWithTeam")}</span>}</label>
              <IdentitySelector
                value={identityId}
                identities={relevantIdentities}
                onChange={(id) => { markDirty(); setIdentityId(id); }}
                onGoToKeychain={() => setActiveNav("keychain")}
              />
            </div>
            )}

            {(fileOnly || !identityId) && (
              <>
                <div>
                  <label className={formLabelClass} style={formLabelStyle}>
                    {t("connections.common.username")}
                  </label>
                  <input
                    className={formInputClass}
                    style={formInputStyle}
                    value={username}
                    onChange={(e) => { markDirty(); setUsername(e.target.value); }}
                    placeholder={DEFAULT_USERNAME[protocol]}
                    {...formIdentifierProps}
                  />
                </div>

                {!secretsHidden && (
                <div>
                  <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.password")}</label>
                  <SecretInput
                    value={password}
                    onChange={(v) => { markDirty(); passwordDirty.current = true; setPassword(v); }}
                    placeholder="••••••••"
                    show={showPassword}
                    onToggleShow={handleTogglePassword}
                  />
                </div>
                )}

                {isFtp && (
                  <SettingRow icon="lucide:shield" label={t("connections.form.ftpsToggle")}>
                    <Toggle checked={ftpSecure} onChange={(v) => { markDirty(); setFtpSecure(v); }} />
                  </SettingRow>
                )}
                {isFtp && (
                  <SettingRow icon="lucide:user-x" label={t("connections.form.anonymousLogin")}>
                    <Toggle checked={username === "anonymous"} onChange={(v) => { markDirty(); setUsername(v ? "anonymous" : ""); }} />
                  </SettingRow>
                )}

                {!fileOnly && (
                <div>
                  <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.privateKey")}</label>
                  <KeySelector
                    value={keyId}
                    keys={relevantKeys}
                    onChange={(id) => { markDirty(); setKeyId(id); if (id) { privateKeyDirty.current = false; setPrivateKey(""); } }}
                    onGoToKeychain={() => setActiveNav("keychain")}
                  />
                  {!keyId && !secretsHidden && (
                    <>
                      <textarea
                        className={`${formInputClass} font-mono text-xs h-28 resize-none mt-2`}
                        style={formInputStyle}
                        value={privateKey}
                        onChange={(e) => { markDirty(); privateKeyDirty.current = true; setPrivateKey(e.target.value); }}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                      />
                      <div className="mt-2">
                        <label className={formLabelClass} style={formLabelStyle}>
                          {t("connections.form.passphrase")} <span className="text-(--t-text-dim) font-normal">{t("connections.form.optional")}</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showPassphrase ? "text" : "password"}
                            className={`${formInputClass} pr-9`}
                            style={formInputStyle}
                            value={passphrase}
                            onChange={(e) => { markDirty(); passphraseDirty.current = true; setPassphrase(e.target.value); }}
                            placeholder={t("connections.form.keyPassphrasePlaceholder")}
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassphrase((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors text-(--t-text-dim)"
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
                            tabIndex={-1}
                          >
                            <Icon icon={showPassphrase ? "lucide:eye-off" : "lucide:eye"} width={14} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                )}
              </>
            )}

            {identityId && selectedIdentity && (
              <div
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-(--t-bg-base) border border-(--t-border)"
              >
                <Icon icon="lucide:user" width={14} className="text-(--t-text-dim)" />
                <div>
                  <p className="text-xs font-medium text-(--t-text-primary)">
                    {selectedIdentity.username}
                  </p>
                  <p className="text-xs text-(--t-text-dim)">
                    {selectedIdentity.key_id ? t("connections.common.sshKey") : t("connections.common.password")}
                  </p>
                </div>
              </div>
            )}

            {initial && !fileOnly && <YouConnectAsRow connection={initial} credential={credential} />}
          </FormSection>
          </ReadOnlyFields>

          <NotesSection value={notes} onChange={(v) => { markDirty(); setNotes(v); }} readOnly={readOnly} />
          {initial && <PermissionsSection objectId={initial.id} vaultId={initial.vault_id} type="connection" />}
        </div>
      </div>
    </PanelShell>

      {/* Jump hosts slide-over */}
      <div
        className="absolute inset-0 transition-transform duration-200 ease-out"
        style={{ transform: showChaining ? "translateX(0)" : "translateX(100%)" }}
      >
        <JumpHostsPanel
          jumpHosts={jumpHosts}
          onChange={(updated) => { markDirty(); setJumpHosts(updated); }}
          onBack={() => setShowChaining(false)}
        />
      </div>

      {/* Environment variables slide-over */}
      <div
        className="absolute inset-0 transition-transform duration-200 ease-out"
        style={{ transform: showEnvVars ? "translateX(0)" : "translateX(100%)" }}
      >
        <EnvVarsPanel
          envVars={envVars}
          onChange={(updated) => { markDirty(); setEnvVars(updated); }}
          onBack={() => setShowEnvVars(false)}
        />
      </div>
    </div>
  );
});

const ConnectionForm = withEditAccess("connection", (p: Props & RefAttributes<ConnectionFormHandle>) => p.initial, ConnectionFormEditor);

export default ConnectionForm;
export type { ConnectionFormHandle };
