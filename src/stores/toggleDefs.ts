// Pure data, no zustand: `settingKeys.ts` needs only TOGGLE_DEFS to build
// SETTING_KEYS, and importing the store for that pulled the whole zustand
// module into any test that partially mocks toggleSettingsStore (e.g. via
// `vi.mock` returning a subset), breaking on missing exports at collection
// time. Consumers that only need the definitions import from here instead,
// so a store mock can never break them.

import type { SettingsSection } from "./uiStore";

export interface ToggleDef {
  /** i18n key resolving to the display label, translated at render time */
  labelKey: string;
  icon: string;
  /** Must be the section that renders it: omnisearch and `setting_list` both report it. */
  section: SettingsSection;
  keywords: string[];
  default: boolean;
}

/**
 * Single source of truth for every boolean toggle setting.
 * Adding a new setting here is the only change required — no edits to
 * OmniSearch, useToggleSettings, or any UI file.
 *
 * `label` is NOT stored here as a literal string — it's an i18n
 * key resolved via t() at render time (see useToggleSettings.ts). The `id`
 * (object key) and `keywords` stay literal English since the id is
 * value-matched for persistence and keywords are search-only, not rendered.
 */
export const TOGGLE_DEFS = {
  "cursor-blink": {
    labelKey: "settings.toggleDefs.cursorBlink.label",
    icon: "lucide:text-cursor",
    section: "terminal",
    keywords: ["cursor", "blink", "terminal", "caret"],
    default: true,
  },
  "scroll-minimap": {
    labelKey: "settings.toggleDefs.scrollMinimap.label",
    icon: "lucide:panel-right",
    section: "terminal",
    keywords: ["minimap", "scrollbar", "terminal", "map"],
    default: true,
  },
  "select-to-copy": {
    labelKey: "settings.toggleDefs.selectToCopy.label",
    icon: "lucide:clipboard-check",
    section: "terminal",
    keywords: ["copy", "select", "clipboard", "terminal", "auto"],
    default: true,
  },
  "drag-selects-text": {
    labelKey: "settings.toggleDefs.dragSelectsText.label",
    icon: "lucide:text-select",
    section: "terminal",
    keywords: ["select", "drag", "mouse", "tmux", "copy", "terminal", "reporting"],
    default: true,
  },
  "group-tabs-by-host": {
    labelKey: "settings.toggleDefs.groupTabsByHost.label",
    icon: "lucide:layers",
    section: "appearance",
    keywords: ["tabs", "group", "stack", "host", "sessions", "titlebar"],
    default: false,
  },
  "ignore-bracketed-paste": {
    labelKey: "settings.toggleDefs.ignoreBracketedPaste.label",
    icon: "lucide:clipboard-x",
    section: "terminal",
    keywords: ["paste", "bracketed", "clipboard", "terminal", "sudo", "garbage", "200~"],
    default: false,
  },
  "auto-forward": {
    labelKey: "settings.toggleDefs.autoForward.label",
    icon: "lucide:arrow-left-right",
    section: "portForwarding",
    keywords: ["forward", "port", "tunnel", "auto", "detect", "ssh"],
    default: true,
  },
  "forwarding-notifications": {
    labelKey: "settings.toggleDefs.forwardingNotifications.label",
    icon: "lucide:bell",
    section: "portForwarding",
    keywords: ["notification", "alert", "forward", "port", "notify"],
    default: false,
  },
  "sftp-tar": {
    labelKey: "settings.toggleDefs.sftpTar.label",
    icon: "lucide:package",
    section: "sftp",
    keywords: ["sftp", "transfer", "tar", "compress", "file", "fast"],
    default: true,
  },
  "sftp-autorefresh": {
    labelKey: "settings.toggleDefs.sftpAutoRefresh.label",
    icon: "lucide:folder-sync",
    section: "sftp",
    keywords: ["sftp", "refresh", "auto", "file", "panel", "reload"],
    default: true,
  },
  "reachability": {
    labelKey: "settings.toggleDefs.reachability.label",
    icon: "lucide:radio-tower",
    section: "hosts",
    keywords: ["ping", "reachability", "status", "check", "connectivity", "dot", "latency"],
    default: true,
  },
  "team-presence": {
    labelKey: "settings.toggleDefs.teamPresence.label",
    icon: "lucide:user-check",
    section: "hosts",
    keywords: ["presence", "team", "avatar", "share", "online", "activity"],
    default: true,
  },
  "shell-integration": {
    labelKey: "settings.toggleDefs.shellIntegration.label",
    icon: "lucide:terminal",
    section: "hosts",
    keywords: ["shell", "integration", "osc", "prompt", "cwd", "directory", "motd", "command"],
    default: true,
  },
  "persistent-sessions": {
    labelKey: "settings.toggleDefs.persistentSessions.label",
    icon: "lucide:history",
    section: "hosts",
    keywords: ["persistent", "session", "tmux", "screen", "reconnect", "survive", "resume", "sleep", "reattach", "keep alive"],
    default: true,
  },
  "restore-workspace": {
    labelKey: "settings.toggleDefs.restoreWorkspace.label",
    icon: "lucide:archive-restore",
    section: "hosts",
    keywords: ["restore", "workspace", "startup", "launch", "tabs", "resume", "reopen", "session"],
    default: true,
  },
  "cross-device-sessions": {
    labelKey: "settings.toggleDefs.crossDeviceSessions.label",
    icon: "lucide:monitor-smartphone",
    section: "hosts",
    keywords: ["cross", "device", "join", "shared", "continue", "mirror", "session", "remote", "tmux", "persistent"],
    default: true,
  },
  "changelog-popup": {
    labelKey: "settings.toggleDefs.changelogPopup.label",
    icon: "lucide:megaphone",
    section: "about",
    keywords: ["changelog", "popup", "release", "notes", "whats new", "update", "version"],
    default: true,
  },
  "plugin-install-review": {
    labelKey: "settings.toggleDefs.pluginInstallReview.label",
    icon: "lucide:shield-check",
    section: "plugins",
    keywords: ["plugin", "permission", "install", "review", "consent", "disclosure", "security"],
    default: true,
  },
  "mcp-server": {
    labelKey: "settings.toggleDefs.mcpServer.label",
    icon: "lucide:plug",
    section: "integrations",
    keywords: ["mcp", "claude", "agent", "server", "socket", "integration"],
    default: false,
  },
} as const satisfies Record<string, ToggleDef>;

export type ToggleId = keyof typeof TOGGLE_DEFS;
