import type { SettingsSection } from "@/stores/uiStore";

export const SETTINGS_NAV: {
  id: SettingsSection;
  label: string;
  icon: string;
  keywords?: string[];
}[] = [
  { id: "appearance", label: "Appearance", icon: "lucide:palette",       keywords: ["theme", "color", "font", "ui"] },
  { id: "account",    label: "Account",    icon: "lucide:user-circle",   keywords: ["profile", "login", "auth"] },
  { id: "vaults",     label: "Vaults",     icon: "lucide:vault",         keywords: ["secret", "password", "storage", "keyring"] },
  { id: "plugins",    label: "Plugins",    icon: "lucide:puzzle",        keywords: ["extensions", "addons", "marketplace"] },
  { id: "sftp",       label: "SFTP",       icon: "lucide:folder-closed", keywords: ["file", "transfer", "ftp", "files"] },
  { id: "hosts",      label: "Hosts",      icon: "lucide:server",        keywords: ["ping", "reachability", "connectivity", "status"] },
  { id: "about",      label: "About",      icon: "lucide:info",          keywords: ["version", "update", "release", "changelog"] },
];
