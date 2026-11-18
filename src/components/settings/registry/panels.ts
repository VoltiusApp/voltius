import type { SettingsSection } from "@/stores/uiStore";
import type { SettingPlatform } from "./types";

export interface SettingsPanel {
  id: string;
  section: SettingsSection;
  labelKey: string;
  descKey?: string;
  keywords: readonly string[];
  platform?: SettingPlatform;
}

export const SETTINGS_PANELS: readonly SettingsPanel[] = [
  { id: "importThemes", section: "appearance", labelKey: "settings.appearance.import", keywords: ["theme", "import", "export"] },
  { id: "newTheme", section: "appearance", labelKey: "settings.appearance.newCustomTheme", keywords: ["theme", "custom", "create", "editor"] },
  { id: "themeMarketplace", section: "appearance", labelKey: "settings.appearance.marketplace.available", keywords: ["theme", "marketplace", "download"] },
  { id: "accountMode", section: "account", labelKey: "settings.account.modeTitle", keywords: ["account", "local", "cloud"] },
  { id: "handle", section: "account", labelKey: "settings.account.handle.title", keywords: ["username", "handle", "profile"] },
  { id: "plan", section: "account", labelKey: "settings.account.plan.title", keywords: ["plan", "billing", "subscription", "pro", "seats"] },
  { id: "email", section: "account", labelKey: "settings.account.email", keywords: ["email", "address"] },
  { id: "strangerInvites", section: "account", labelKey: "settings.account.strangerInvites.label", descKey: "settings.account.strangerInvites.desc", keywords: ["invite", "share", "privacy"] },
  { id: "changePassword", section: "account", labelKey: "settings.account.changeMasterPassword.label", keywords: ["password", "master", "security"] },
  { id: "twoFactor", section: "account", labelKey: "settings.account.twoFactor.label", keywords: ["2fa", "totp", "otp", "authenticator", "passkey", "recovery", "security"] },
  { id: "rememberPassword", section: "account", labelKey: "settings.account.sessionSecurity.rememberPassword.toggle", descKey: "settings.account.sessionSecurity.rememberPassword.desc", keywords: ["password", "remember", "unlock", "security"] },
  { id: "lockVault", section: "account", labelKey: "settings.account.lockVault.label", keywords: ["lock", "vault"] },
  { id: "sessions", section: "account", labelKey: "settings.account.sessions.title", keywords: ["sessions", "devices", "sign out", "logout"] },
  { id: "vaultBackups", section: "account", labelKey: "shared.vaultBackups.title", keywords: ["backup", "restore", "vault"] },
  { id: "signOut", section: "account", labelKey: "settings.account.signOut.label", keywords: ["logout", "sign out"] },
  { id: "deleteAccount", section: "account", labelKey: "shared.deleteAccount.action", keywords: ["delete", "account", "remove"] },
  { id: "wipeData", section: "account", labelKey: "settings.account.wipeData.label", keywords: ["wipe", "reset", "erase", "data"] },
  { id: "syncPause", section: "sync", labelKey: "settings.sync.pause.label", descKey: "settings.sync.pause.sub", keywords: ["sync", "pause", "cloud"] },
  { id: "lanPause", section: "sync", labelKey: "layout.sync.local.pause", descKey: "settings.sync.local.pauseSub", keywords: ["sync", "pause", "local", "lan", "network"] },
  { id: "syncDevices", section: "sync", labelKey: "settings.sync.devices.title", keywords: ["sync", "devices"] },
  { id: "syncProviders", section: "sync", labelKey: "settings.sync.providersTitle", keywords: ["sync", "plugin", "provider", "gist"] },
  { id: "pluginsInstalled", section: "plugins", labelKey: "settings.nav.plugins.label", keywords: ["plugins", "extensions", "installed", "marketplace", "browse"] },
  { id: "mcpSetup", section: "integrations", labelKey: "settings.integrations.mcp.quickSetup.title", keywords: ["mcp", "ai", "claude", "agent", "setup"], platform: "desktop" },
  { id: "downloadFolder", section: "sftp", labelKey: "settings.sftp.downloads.folderLabel", keywords: ["download", "folder", "files"], platform: "mobile" },
  { id: "sshConfig", section: "hosts", labelKey: "settings.hosts.sshConfig.switch.title", descKey: "settings.hosts.sshConfig.switch.desc", keywords: ["ssh", "config", "import", "openssh"], platform: "desktop" },
  { id: "fileAccess", section: "devices", labelKey: "settings.devices.fileAccess.enable.title", descKey: "settings.devices.fileAccess.enable.desc", keywords: ["files", "share", "folders", "remote"] },
  { id: "fileAccessReadOnly", section: "devices", labelKey: "settings.devices.fileAccess.readOnly.title", keywords: ["files", "read-only"] },
  { id: "fileAccessFolders", section: "devices", labelKey: "settings.devices.fileAccess.folders", keywords: ["files", "folders"] },
  { id: "allowedDevices", section: "devices", labelKey: "settings.devices.allowed.title", keywords: ["devices", "allowed", "revoke"] },
  { id: "verboseLogging", section: "diagnostics", labelKey: "settings.diagnostics.verboseLabel", descKey: "settings.diagnostics.verboseSub", keywords: ["log", "debug", "verbose"] },
  { id: "bugReport", section: "diagnostics", labelKey: "settings.diagnostics.reportTitle", keywords: ["bug", "report", "logs", "diagnostics"] },
  { id: "updates", section: "about", labelKey: "settings.about.updatesTitle", keywords: ["update", "version", "upgrade"], platform: "desktop" },
  { id: "version", section: "about", labelKey: "settings.about.versionTitle", keywords: ["version", "about"] },
];
