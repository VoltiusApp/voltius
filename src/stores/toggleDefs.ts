// Pure data, no zustand: `settingKeys.ts` needs only TOGGLE_DEFS to build
// SETTING_KEYS, and importing the store for that pulled the whole zustand
// module into any test that partially mocks toggleSettingsStore (e.g. via
// `vi.mock` returning a subset), breaking on missing exports at collection
// time. Consumers that only need the definitions import from here instead,
// so a store mock can never break them.

export interface ToggleDef {
  /** i18n key resolving to the display label, translated at render time */
  labelKey: string;
  icon: string;
  /** i18n key resolving to the display description (category), translated at render time */
  descriptionKey: string;
  keywords: string[];
  default: boolean;
}

/**
 * Single source of truth for every boolean toggle setting.
 * Adding a new setting here is the only change required — no edits to
 * OmniSearch, useToggleSettings, or any UI file.
 *
 * `label`/`description` are NOT stored here as literal strings — they're i18n
 * keys resolved via t() at render time (see useToggleSettings.ts). The `id`
 * (object key) and `keywords` stay literal English since the id is
 * value-matched for persistence and keywords are search-only, not rendered.
 */
export const TOGGLE_DEFS = {
  "cursor-blink": {
    labelKey: "settings.toggleDefs.cursorBlink.label",
    icon: "lucide:text-cursor",
    descriptionKey: "settings.toggleDefs.category.appearance",
    keywords: ["cursor", "blink", "terminal", "caret"],
    default: true,
  },
  "scroll-minimap": {
    labelKey: "settings.toggleDefs.scrollMinimap.label",
    icon: "lucide:panel-right",
    descriptionKey: "settings.toggleDefs.category.appearance",
    keywords: ["minimap", "scrollbar", "terminal", "map"],
    default: true,
  },
  "select-to-copy": {
    labelKey: "settings.toggleDefs.selectToCopy.label",
    icon: "lucide:clipboard-check",
    descriptionKey: "settings.toggleDefs.category.appearance",
    keywords: ["copy", "select", "clipboard", "terminal", "auto"],
    default: true,
  },
  "ignore-bracketed-paste": {
    labelKey: "settings.toggleDefs.ignoreBracketedPaste.label",
    icon: "lucide:clipboard-x",
    descriptionKey: "settings.toggleDefs.category.appearance",
    keywords: ["paste", "bracketed", "clipboard", "terminal", "sudo", "garbage", "200~"],
    default: false,
  },
  "auto-forward": {
    labelKey: "settings.toggleDefs.autoForward.label",
    icon: "lucide:arrow-left-right",
    descriptionKey: "settings.toggleDefs.category.portForwarding",
    keywords: ["forward", "port", "tunnel", "auto", "detect", "ssh"],
    default: true,
  },
  "forwarding-notifications": {
    labelKey: "settings.toggleDefs.forwardingNotifications.label",
    icon: "lucide:bell",
    descriptionKey: "settings.toggleDefs.category.portForwarding",
    keywords: ["notification", "alert", "forward", "port", "notify"],
    default: false,
  },
  "sftp-tar": {
    labelKey: "settings.toggleDefs.sftpTar.label",
    icon: "lucide:package",
    descriptionKey: "settings.toggleDefs.category.sftp",
    keywords: ["sftp", "transfer", "tar", "compress", "file", "fast"],
    default: true,
  },
  "sftp-autorefresh": {
    labelKey: "settings.toggleDefs.sftpAutoRefresh.label",
    icon: "lucide:folder-sync",
    descriptionKey: "settings.toggleDefs.category.sftp",
    keywords: ["sftp", "refresh", "auto", "file", "panel", "reload"],
    default: true,
  },
  "reachability": {
    labelKey: "settings.toggleDefs.reachability.label",
    icon: "lucide:radio-tower",
    descriptionKey: "settings.toggleDefs.category.hosts",
    keywords: ["ping", "reachability", "status", "check", "connectivity", "dot", "latency"],
    default: true,
  },
  "team-presence": {
    labelKey: "settings.toggleDefs.teamPresence.label",
    icon: "lucide:user-check",
    descriptionKey: "settings.toggleDefs.category.hosts",
    keywords: ["presence", "team", "avatar", "share", "online", "activity"],
    default: true,
  },
  "shell-integration": {
    labelKey: "settings.toggleDefs.shellIntegration.label",
    icon: "lucide:terminal",
    descriptionKey: "settings.toggleDefs.category.hosts",
    keywords: ["shell", "integration", "osc", "prompt", "cwd", "directory", "motd", "command"],
    default: true,
  },
  "persistent-sessions": {
    labelKey: "settings.toggleDefs.persistentSessions.label",
    icon: "lucide:history",
    descriptionKey: "settings.toggleDefs.category.hosts",
    keywords: ["persistent", "session", "tmux", "screen", "reconnect", "survive", "resume", "sleep", "reattach", "keep alive"],
    default: true,
  },
  "restore-workspace": {
    labelKey: "settings.toggleDefs.restoreWorkspace.label",
    icon: "lucide:archive-restore",
    descriptionKey: "settings.toggleDefs.category.hosts",
    keywords: ["restore", "workspace", "startup", "launch", "tabs", "resume", "reopen", "session"],
    default: true,
  },
  "cross-device-sessions": {
    labelKey: "settings.toggleDefs.crossDeviceSessions.label",
    icon: "lucide:monitor-smartphone",
    descriptionKey: "settings.toggleDefs.category.hosts",
    keywords: ["cross", "device", "join", "shared", "continue", "mirror", "session", "remote", "tmux", "persistent"],
    default: true,
  },
  "changelog-popup": {
    labelKey: "settings.toggleDefs.changelogPopup.label",
    icon: "lucide:megaphone",
    descriptionKey: "settings.toggleDefs.category.updates",
    keywords: ["changelog", "popup", "release", "notes", "whats new", "update", "version"],
    default: true,
  },
  "plugin-install-review": {
    labelKey: "settings.toggleDefs.pluginInstallReview.label",
    icon: "lucide:shield-check",
    descriptionKey: "settings.toggleDefs.category.plugins",
    keywords: ["plugin", "permission", "install", "review", "consent", "disclosure", "security"],
    default: true,
  },
  "mcp-server": {
    labelKey: "settings.toggleDefs.mcpServer.label",
    icon: "lucide:plug",
    descriptionKey: "settings.toggleDefs.category.integrations",
    keywords: ["mcp", "claude", "agent", "server", "socket", "integration"],
    default: false,
  },
} as const satisfies Record<string, ToggleDef>;

export type ToggleId = keyof typeof TOGGLE_DEFS;
