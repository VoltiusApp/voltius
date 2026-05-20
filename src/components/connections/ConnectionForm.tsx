import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import type { Connection, ConnectionFormData, AuthType, VaultOption, JumpHost, EnvVar } from "@/types";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import JumpHostsPanel from "./JumpHostsPanel";
import EnvVarsPanel from "./EnvVarsPanel";
import { useUIStore } from "@/stores/uiStore";
import { getSecret } from "@/services/vault";
import { sshExecCommand } from "@/services/ssh";
import { useAutosave } from "@/hooks/useAutosave";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAuditClientEvent } from "@/services/auditReporter";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useFolderStore } from "@/stores/folderStore";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import IdentitySelector from "./IdentitySelector";
import KeySelector from "./KeySelector";
import TagSelector from "./TagSelector";
import EncodingSelector from "./EncodingSelector";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useConnectionStore } from "@/stores/connectionStore";
import { buildConnectionMenuItems } from "@/utils/connectionMenuItems";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { Toggle } from "@/components/shared/Toggle";
import FolderSelector from "./FolderSelector";
import { CONNECTION_ICON_OPTIONS, getConnectionIcon, getConnectionIconColor, getConnectionIconLabel, normalizeDistro } from "@/utils/icons";
import {
  PanelShell,
  PanelHeader,
  FormSection,
  formInputClass,
  formInputStyle,
  formLabelClass,
  formLabelStyle,
} from "@/components/shared/Panel";

interface Props {
  initial?: Connection;
  onSubmit: (data: ConnectionFormData, password: string | null, privateKey: string | null) => void | Promise<void>;
  onClose: () => void;
  onDuplicate?: () => void;
  onConnect?: () => void;
  onDelete?: () => void;
  /** Other vaults available for move/copy (excludes the connection's current vault) */
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
}

export interface ConnectionFormHandle {
  flush: () => void;
  isDirty: () => boolean;
}

const ConnectionForm = forwardRef<ConnectionFormHandle, Props>(function ConnectionForm({ initial, onSubmit, onClose, onDuplicate, onConnect, onDelete, vaults, canEdit, onMoveToVault, onCopyToVault }, ref) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState<number | "">(initial?.port ?? 22);
  const [username, setUsername] = useState(initial?.username ?? "root");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [identityId, setIdentityId] = useState<string | null>(initial?.identity_id ?? null);
  const [keyId, setKeyId] = useState<string | null>(initial?.key_id ?? null);
  const [folderId, setFolderId] = useState<string | null>(initial?.folder_id ?? null);
  const [jumpHosts, setJumpHosts] = useState<JumpHost[]>(initial?.jump_hosts ?? []);
  const [showChaining, setShowChaining] = useState(false);
  const [envVars, setEnvVars] = useState<EnvVar[]>(initial?.env_vars ?? []);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [agentForwarding, setAgentForwarding] = useState(initial?.agent_forwarding ?? false);
  const [pingDisabled, setPingDisabled] = useState(initial?.ping_disabled ?? false);
  const [preCommand, setPreCommand] = useState(initial?.pre_command ?? "");
  const [postCommand, setPostCommand] = useState(initial?.post_command ?? "");
  const [terminalEncoding, setTerminalEncoding] = useState(initial?.terminal_encoding ?? "");
  const [distro, setDistro] = useState(initial?.distro ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [showDistroPicker, setShowDistroPicker] = useState(false);
  const [distroSearch, setDistroSearch] = useState("");
  const [detectingDistro, setDetectingDistro] = useState(false);
  const [distroError, setDistroError] = useState("");
  const [distroPickerRect, setDistroPickerRect] = useState<DOMRect | null>(null);
  const hasAdvanced = !!(initial?.jump_hosts?.length || initial?.env_vars?.length || initial?.pre_command || initial?.post_command || initial?.terminal_encoding || initial?.agent_forwarding || initial?.ping_disabled);
  const [showAdvanced, setShowAdvanced] = useState(hasAdvanced);
  const defaultVaultId = useDefaultVaultId();
  const [vaultId, setVaultId] = useState<string>(() => initial?.vault_id ?? defaultVaultId);
  const prevVaultIdRef = useRef(vaultId);
  const isNew = !initial;
  const vaultPickerTouched = useRef(false);
  useEffect(() => {
    if (isNew && !vaultPickerTouched.current) {
      setVaultId(defaultVaultId);
    }
  }, [isNew, defaultVaultId]);
  const passwordDirty = useRef(false);
  const privateKeyDirty = useRef(false);
  const userEditedRef = useRef(false);
  const distroPickerRef = useRef<HTMLDivElement>(null);
  const distroPickerMenuRef = useRef<HTMLDivElement>(null);

  const { identities, teamIdentities, loadIdentities } = useIdentityStore();
  const { keys, teamKeys, loadKeys } = useKeyStore();
  const relevantIdentities = useMemo(() => {
    if (vaultId === "personal") return identities;
    const teamId = resolveVaultIdForSave(vaultId);
    return teamIdentities[teamId] ?? [];
  }, [vaultId, identities, teamIdentities]);
  const relevantKeys = useMemo(() => {
    if (vaultId === "personal") return keys;
    const teamId = resolveVaultIdForSave(vaultId);
    return teamKeys[teamId] ?? [];
  }, [vaultId, keys, teamKeys]);
  useEffect(() => {
    if (prevVaultIdRef.current !== vaultId) {
      prevVaultIdRef.current = vaultId;
      setIdentityId(null);
      setKeyId(null);
    }
  }, [vaultId]);
  const { folders, loadFolders, saveFolder } = useFolderStore();
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const setConnectionDistro = useConnectionStore((s) => s.setDistro);
  const effPinned = useEffectivePinned(initial ?? { id: "", pinned: false }, "connection");
  const pinSource = useEffectivePinSource(initial ?? { id: "", pinned: false }, "connection");
  const isPinned = effPinned;
  const isTeamVault = useTeamStore((s) => initial ? s.teams.some((t) => t.id === initial.vault_id) : false);
  const contributions = useUIContributions("connection.panelActions", initial);
  const { toggleExcluded, isObjectSynced } = useSyncPrefsStore();
  const isSynced = initial ? isObjectSynced(initial.id, "connection") : true;

  useEffect(() => {
    void loadIdentities();
    void loadKeys();
    void loadFolders();
  }, [loadIdentities, loadKeys, loadFolders]);

  useEffect(() => {
    if (!showDistroPicker) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!distroPickerRef.current?.contains(target) && !distroPickerMenuRef.current?.contains(target)) {
        setShowDistroPicker(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showDistroPicker]);

  useEffect(() => {
    if (!showDistroPicker) return;
    const updateRect = () => {
      if (distroPickerRef.current) setDistroPickerRect(distroPickerRef.current.getBoundingClientRect());
    };
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [showDistroPicker]);

  // Load existing secrets when editing
  useEffect(() => {
    if (!initial) return;
    (async () => {
      const pwd = await getSecret(`password:${initial.id}`).catch(() => null);
      if (pwd && !passwordDirty.current) setPassword(pwd);
      if (!initial.key_id) {
        const key = await getSecret(`key:${initial.id}`).catch(() => null);
        if (key && !privateKeyDirty.current) setPrivateKey(key);
      }
    })();
  }, [initial?.id]);

  const selectedIdentity = relevantIdentities.find((i) => i.id === identityId) ?? null;

  const buildSubmit = () => {
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
        pre_command: preCommand.trim() || undefined,
        post_command: postCommand.trim() || undefined,
        terminal_encoding: terminalEncoding || undefined,
        distro: distro || undefined,
        icon: icon || undefined,
        ping_disabled: pingDisabled || undefined,
      } as ConnectionFormData,
      password: passwordDirty.current ? password : null,
      privateKey: (!identityId && !keyId && privateKeyDirty.current) ? privateKey : null,
    };
  };

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => { const { data, password: pwd, privateKey: pk } = buildSubmit(); return onSubmit(data, pwd, pk) ?? undefined; },
    canSave: () => !!host.trim() && !!username.trim() && (port === "" || (port >= 1 && port <= 65535)),
  });
  const markDirty = useCallback(() => { userEditedRef.current = true; _markDirty(); }, [_markDirty]);


  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, host, port, username, password, privateKey, identityId, keyId, folderId, tags, vaultId, jumpHosts, envVars, agentForwarding, preCommand, postCommand, terminalEncoding, distro, icon, pingDisabled]);

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

  const toggleDistroPicker = () => {
    if (distroPickerRef.current) setDistroPickerRect(distroPickerRef.current.getBoundingClientRect());
    setShowDistroPicker((v) => !v);
  };

  const visibleIcon = icon || distro;

  const filteredIcons = useMemo(() => {
    const query = distroSearch.trim().toLowerCase();
    if (!query) return CONNECTION_ICON_OPTIONS;
    return CONNECTION_ICON_OPTIONS.filter((option) => option.label.toLowerCase().includes(query) || option.id.includes(query) || option.group.toLowerCase().includes(query));
  }, [distroSearch]);

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

      if (identityId && selectedIdentity) {
        detectUsername = selectedIdentity.username;
        detectPassword = (await getSecret(`identity:${identityId}:password`).catch(() => null)) ?? undefined;
        detectPrivateKey = selectedIdentity.key_id
          ? (await getSecret(`key:${selectedIdentity.key_id}:private`).catch(() => null)) ?? undefined
          : undefined;
      } else if (keyId) {
        detectPrivateKey = (await getSecret(`key:${keyId}:private`).catch(() => null)) ?? undefined;
        if (initial) {
          detectPassword = passwordDirty.current ? (password || undefined) : ((await getSecret(`password:${initial.id}`).catch(() => null)) ?? undefined);
        } else {
          detectPassword = password || undefined;
        }
      } else if (initial) {
        detectPassword = passwordDirty.current ? (password || undefined) : ((await getSecret(`password:${initial.id}`).catch(() => null)) ?? undefined);
        detectPrivateKey = privateKeyDirty.current ? (privateKey || undefined) : ((await getSecret(`key:${initial.id}`).catch(() => null)) ?? undefined);
      }

      const output = await sshExecCommand({
        host: host.trim(),
        port: port || 22,
        username: detectUsername.trim(),
        password: detectPassword,
        privateKey: detectPrivateKey,
        command: "cat /etc/os-release 2>/dev/null || echo ID=linux",
      });
      const idLine = output.split(/\r?\n/).find((line) => line.startsWith("ID="));
      const detected = normalizeDistro(idLine?.slice(3).trim().replace(/^\"|\"$/g, "") || "linux");
      applyDetectedDistro(detected);
    } catch (err) {
      setDistroError(String(err));
    } finally {
      setDetectingDistro(false);
    }
  }, [applyDetectedDistro, host, identityId, keyId, initial, password, port, privateKey, selectedIdentity, username]);

  const panelItems = initial ? buildConnectionMenuItems({
    canEdit,
    contributions,
    vaults,
    isSynced,
    pingDisabled,
    onConnect: () => onConnect?.(),
    onDuplicate: () => onDuplicate?.(),
    onMoveToVault,
    onCopyToVault,
    onToggleSync: () => toggleExcluded(initial.id),
    onTogglePing: () => { markDirty(); setPingDisabled((v) => !v); },
    onDelete: onDelete ? () => onDelete() : undefined,
  }) : [];

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
    <PanelShell>
      <PanelHeader
        icon={initial ? "lucide:pencil" : "lucide:plus"}
        title={initial ? "Edit Host" : "New Host"}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => { vaultPickerTouched.current = true; setVaultId(id); markDirty(); }} />}
        onClose={handleClose}
        saveState={initial ? saveState : undefined}
        actions={initial ? (
          <>
            <PinButton pinned={isPinned} onToggle={() => {
              if (!isTeamVault) {
                pinConnection(initial.id, !isPinned).catch(() => {});
              } else {
                pinConnection(initial.id, nextPersonalPinValue(pinSource)).catch(() => {});
              }
            }} />
            {panelItems.length > 0 && <PanelActionsMenu items={panelItems} />}
          </>
        ) : undefined}
      />

      <div className="flex flex-col flex-1 overflow-y-auto">
        <div className="flex-1 px-4 py-4 space-y-3">

          <FormSection label="General">
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Label</label>
              <div className="relative flex gap-2.5" ref={distroPickerRef}>
                <button
                  type="button"
                  onClick={toggleDistroPicker}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 border border-[var(--t-border)] hover:border-[var(--t-border-hover)] transition-colors"
                  style={{ background: visibleIcon ? getConnectionIconColor(visibleIcon) : "var(--t-bg-card-avatar)" }}
                  title={visibleIcon ? `Change icon (${getConnectionIconLabel(visibleIcon)})` : "Change icon"}
                  aria-label="Change connection icon"
                >
                  <Icon icon={visibleIcon ? getConnectionIcon(visibleIcon) : "lucide:server"} width={18} />
                </button>
                <input
                  className={formInputClass}
                  style={formInputStyle}
                  value={name}
                  onChange={(e) => { markDirty(); setName(e.target.value); }}
                  placeholder="My Server (optional)"
                />

                {showDistroPicker && distroPickerRect && createPortal(
                  <div
                    ref={distroPickerMenuRef}
                    className="fixed z-50 rounded-xl border p-3 space-y-3"
                    style={{
                      left: Math.max(12, Math.min(distroPickerRect.left, window.innerWidth - distroPickerRect.width - 12)),
                      top: Math.min(distroPickerRect.bottom + 8, window.innerHeight - 360),
                      width: distroPickerRect.width,
                      background: "var(--t-bg-modal)",
                      borderColor: "var(--t-border-hover)",
                      boxShadow: "0 18px 48px rgba(0,0,0,0.45), inset 0 1px 0 color-mix(in srgb, var(--t-text-bright) 8%, transparent)",
                    }}
                  >
                    <div className="relative">
                      <Icon icon="lucide:search" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t-text-dim)] pointer-events-none" />
                      <input
                        className={`${formInputClass} pl-7 text-xs`}
                        style={formInputStyle}
                        value={distroSearch}
                        onChange={(e) => setDistroSearch(e.target.value)}
                        placeholder="Search icon"
                        autoFocus
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-2 max-h-52 overflow-y-auto pr-1">
                      {filteredIcons.map((option) => {
                        const selected = visibleIcon === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => { applyIcon(option.id); setShowDistroPicker(false); }}
                            className="flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors"
                            style={{
                              background: selected
                                ? "color-mix(in srgb, var(--t-accent) 18%, var(--t-bg-input))"
                                : "var(--t-bg-input)",
                              borderColor: selected ? "var(--t-accent)" : "var(--t-border)",
                            }}
                            onMouseEnter={(e) => {
                              if (!selected) {
                                e.currentTarget.style.background = "var(--t-bg-input-hover)";
                                e.currentTarget.style.borderColor = "var(--t-border-hover)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!selected) {
                                e.currentTarget.style.background = "var(--t-bg-input)";
                                e.currentTarget.style.borderColor = "var(--t-border)";
                              }
                            }}
                            title={option.label}
                          >
                            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: getConnectionIconColor(option.id) }}>
                              <Icon icon={getConnectionIcon(option.id)} width={16} />
                            </span>
                            <span className="text-[10px] text-[var(--t-text-dim)] truncate max-w-full">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => void detectDistroFromForm()}
                      disabled={detectingDistro || !host.trim() || !username.trim()}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--t-accent)] text-[var(--t-bg-card)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Icon icon={detectingDistro ? "lucide:loader-2" : "lucide:scan-search"} width={13} className={detectingDistro ? "animate-spin" : undefined} />
                      Auto-detect OS
                    </button>
                    {distroError && <p className="text-[11px] text-red-400 leading-snug">{distroError}</p>}
                  </div>,
                  document.body,
                )}
              </div>
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Tags</label>
              <TagSelector
                value={tags}
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

          <FormSection label="Connection">
            <div className="flex gap-2.5">
              <div className="flex-1">
                <label className={formLabelClass} style={formLabelStyle}>Host / IP <span className="text-[var(--t-accent)]">*</span></label>
                <input
                  className={formInputClass}
                  style={formInputStyle}
                  value={host}
                  onChange={(e) => { markDirty(); setHost(e.target.value); }}
                  placeholder="192.168.1.1"
                />
              </div>
              <div className="w-20">
                <label className={formLabelClass} style={formLabelStyle}>Port <span className="text-[var(--t-accent)]">*</span></label>
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
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors w-full pt-1"
            >
              <span>Advanced</span>
              {!showAdvanced && (jumpHosts.length > 0 || envVars.length > 0 || preCommand || postCommand || terminalEncoding || agentForwarding || pingDisabled) && (
                <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-[var(--t-accent)]" />
              )}
              <Icon icon={showAdvanced ? "lucide:chevron-up" : "lucide:chevron-down"} width={12} className="ml-auto" />
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-out"
              style={{ gridTemplateRows: showAdvanced ? "1fr" : "0fr", marginTop: showAdvanced ? undefined : 0 }}
            >
              <div className="overflow-hidden">
              <div className="space-y-3 mt-3">
                <button
                  type="button"
                  onClick={() => setShowChaining(true)}
                  className="flex items-center gap-1.5 text-xs text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors w-full py-1"
                >
                  <Icon icon="lucide:waypoints" width={13} />
                  <span>Hosts Chaining</span>
                  {jumpHosts.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[var(--t-accent)] text-[var(--t-bg-card)] text-[10px] font-bold leading-none">
                      {jumpHosts.length}
                    </span>
                  )}
                  <Icon icon="lucide:chevron-right" width={12} className="ml-auto" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnvVars(true)}
                  className="flex items-center gap-1.5 text-xs text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors w-full py-1"
                >
                  <Icon icon="lucide:file-terminal" width={13} />
                  <span>Environment Variables</span>
                  {envVars.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[var(--t-accent)] text-[var(--t-bg-card)] text-[10px] font-bold leading-none">
                      {envVars.length}
                    </span>
                  )}
                  <Icon icon="lucide:chevron-right" width={12} className="ml-auto" />
                </button>
                <div className="relative">
                  <Icon icon="lucide:play" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t-text-dim)] pointer-events-none" />
                  <input
                    className={`${formInputClass} text-xs pl-7`}
                    style={formInputStyle}
                    value={preCommand}
                    onChange={(e) => { markDirty(); setPreCommand(e.target.value); }}
                    placeholder="Pre Command"
                  />
                </div>
                <div className="relative">
                  <Icon icon="lucide:square" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t-text-dim)] pointer-events-none" />
                  <input
                    className={`${formInputClass} text-xs pl-7`}
                    style={formInputStyle}
                    value={postCommand}
                    onChange={(e) => { markDirty(); setPostCommand(e.target.value); }}
                    placeholder="Post Command"
                  />
                </div>
                <EncodingSelector
                  value={terminalEncoding}
                  onChange={(v) => { markDirty(); setTerminalEncoding(v); }}
                />
                <div className="flex items-center gap-1.5 text-xs text-[var(--t-text-dim)] w-full py-1">
                  <Icon icon="lucide:key-round" width={13} />
                  <span>Agent Forwarding</span>
                  <span className="ml-auto">
                    <Toggle
                      checked={agentForwarding}
                      onChange={(v) => { markDirty(); setAgentForwarding(v); }}
                    />
                  </span>
                </div>

              </div>
              </div>
            </div>
          </FormSection>

          <FormSection label="Identity">
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Keychain Identity</label>
              <IdentitySelector
                value={identityId}
                identities={relevantIdentities}
                onChange={(id) => { markDirty(); setIdentityId(id); }}
                onGoToKeychain={() => setActiveNav("keychain")}
              />
            </div>

            {!identityId && (
              <>
                <div>
                  <label className={formLabelClass} style={formLabelStyle}>
                    Username <span className="text-[var(--t-accent)]">*</span>
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
                  <SecretInput
                    value={password}
                    onChange={(v) => { markDirty(); passwordDirty.current = true; setPassword(v); }}
                    placeholder="••••••••"
                    show={showPassword}
                    onToggleShow={handleTogglePassword}
                  />
                </div>

                <div>
                  <label className={formLabelClass} style={formLabelStyle}>Private Key</label>
                  <KeySelector
                    value={keyId}
                    keys={relevantKeys}
                    onChange={(id) => { markDirty(); setKeyId(id); if (id) { privateKeyDirty.current = false; setPrivateKey(""); } }}
                    onGoToKeychain={() => setActiveNav("keychain")}
                  />
                  {!keyId && (
                    <textarea
                      className={`${formInputClass} font-mono text-xs h-28 resize-none mt-2`}
                      style={formInputStyle}
                      value={privateKey}
                      onChange={(e) => { markDirty(); privateKeyDirty.current = true; setPrivateKey(e.target.value); }}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                    />
                  )}
                </div>
              </>
            )}

            {identityId && selectedIdentity && (
              <div
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--t-bg-base)] border border-[var(--t-border)]"
              >
                <Icon icon="lucide:user" width={14} className="text-[var(--t-text-dim)]" />
                <div>
                  <p className="text-xs font-medium text-[var(--t-text-primary)]">
                    {selectedIdentity.username}
                  </p>
                  <p className="text-xs text-[var(--t-text-dim)]">
                    {selectedIdentity.key_id ? "SSH Key" : "Password"}
                  </p>
                </div>
              </div>
            )}
          </FormSection>
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

export default ConnectionForm;

function SecretInput({
  value,
  onChange,
  placeholder,
  show,
  onToggleShow,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className={`${formInputClass} pr-9`}
        style={formInputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors text-[var(--t-text-dim)]"
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
        tabIndex={-1}
      >
        <Icon icon={show ? "lucide:eye-off" : "lucide:eye"} width={14} />
      </button>
    </div>
  );
}
