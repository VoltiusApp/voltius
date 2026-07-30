/**
 * Permissions that require explicit, danger-styled user consent at install.
 * Enforcement is upstream at the consent surface (describePermissions + the
 * install/update dialog), NOT by load provenance — a plugin holds a gated perm
 * when the user knowingly consented to it. The runtime `requireGated` only
 * verifies the manifest declared it. The list names which strings are gated;
 * expected to grow over time. Any perm added here should also get a
 * PERMISSION_COPY entry below, else it renders danger-styled but as a bare
 * string with no description.
 */
export const GATED_PERMISSIONS = new Set<string>([
  "terminal:read",
  "terminal:stream",
  "terminal:write",
  "keychain:read",
  "keychain:write",
  "metrics:read",
  "processes:read",
  "processes:manage",
  "docker:read",
  "docker:manage",
  "proxmox:read",
  "proxmox:manage",
]);

export function isGatedPermission(perm: string): boolean {
  return GATED_PERMISSIONS.has(perm);
}

export interface PermissionDescriptor {
  perm: string;
  gated: boolean;
  danger: boolean;
  /** Whether a plain-language copy entry exists (else render the bare perm string). */
  known: boolean;
  /** i18n key for the label; "" when unknown. */
  labelKey: string;
  /** i18n key for the description; "" when unknown. */
  descriptionKey: string;
}

/**
 * Maps a permission string to its i18n copy stem under
 * settings.plugins.permissionModal.permissions.<stem>.{label,description}.
 * Any perm absent here renders as its bare string (still shown, never hidden).
 */
const PERMISSION_COPY: Record<string, string> = {
  "terminal:read": "terminalRead",
  "terminal:stream": "terminalStream",
  "terminal:write": "terminalWrite",
  "keychain:read": "keychainRead",
  "keychain:write": "keychainWrite",
  "metrics:read": "metricsRead",
  "processes:read": "processesRead",
  "processes:manage": "processesManage",
  "docker:read": "dockerRead",
  "docker:manage": "dockerManage",
  "proxmox:read": "proxmoxRead",
  "proxmox:manage": "proxmoxManage",
  "sessions:read": "sessionsRead",
  "sessions:write": "sessionsWrite",
  "connections:read": "connectionsRead",
  "connections:write": "connectionsWrite",
  "keys:read": "keysRead",
  "keys:write": "keysWrite",
  "identities:read": "identitiesRead",
  "identities:write": "identitiesWrite",
  "vault:read": "vaultRead",
  "vault:write": "vaultWrite",
  "sync:read": "syncRead",
  "sync:write": "syncWrite",
  storage: "storage",
  http: "http",
  "crypto:derive": "cryptoDerive",
  fs: "fs",
  ui: "ui",
  notifications: "notifications",
  "settings-page": "settingsPage",
  "right-panel": "rightPanel",
  "global-panel": "globalPanel",
  themes: "themes",
  "omni-commands": "omniCommands",
  "sidebar-item": "sidebarItem",
  "context-menu": "contextMenu",
  "ui-contributions": "uiContributions",
};

const COPY_ROOT = "settings.plugins.permissionModal.permissions";

/** Annotate every declared permission for the consent surface. Nothing is filtered. */
export function describePermissions(perms: string[]): PermissionDescriptor[] {
  return perms.map((perm) => {
    const stem = PERMISSION_COPY[perm];
    const gated = isGatedPermission(perm);
    return {
      perm,
      gated,
      danger: gated,
      known: stem !== undefined,
      labelKey: stem ? `${COPY_ROOT}.${stem}.label` : "",
      descriptionKey: stem ? `${COPY_ROOT}.${stem}.description` : "",
    };
  });
}

/** True when any declared permission is on the gated tier. */
export function hasGatedPermission(perms: string[]): boolean {
  return perms.some(isGatedPermission);
}

/**
 * Whether the install-consent dialog must be shown. Gated perms are never
 * auto-installable silently: a manifest with any gated perm always prompts,
 * regardless of the plugin-install-review toggle.
 */
export function requiresInstallConsent(perms: string[], reviewEnabled: boolean): boolean {
  return reviewEnabled || hasGatedPermission(perms);
}
