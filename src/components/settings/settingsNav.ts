import type { SettingsSection } from "@/stores/uiStore";
import i18n from "@/i18n";

export function getSettingsNav(): {
  id: SettingsSection;
  label: string;
  icon: string;
  keywords?: string[];
}[] {
  return [
    { id: "appearance",     label: i18n.t("settings.nav.appearance.label"),     icon: "lucide:palette",          keywords: i18n.t("settings.nav.appearance.keywords",     { returnObjects: true }) as string[] },
    { id: "account",        label: i18n.t("settings.nav.account.label"),        icon: "lucide:circle-user",      keywords: i18n.t("settings.nav.account.keywords",        { returnObjects: true }) as string[] },
    { id: "sync",           label: i18n.t("settings.nav.sync.label"),           icon: "lucide:cloud",            keywords: i18n.t("settings.nav.sync.keywords",           { returnObjects: true }) as string[] },
    { id: "vaults",         label: i18n.t("settings.nav.vaults.label"),         icon: "lucide:vault",            keywords: i18n.t("settings.nav.vaults.keywords",         { returnObjects: true }) as string[] },
    { id: "plugins",        label: i18n.t("settings.nav.plugins.label"),        icon: "lucide:puzzle",           keywords: i18n.t("settings.nav.plugins.keywords",        { returnObjects: true }) as string[] },
    { id: "sftp",           label: i18n.t("settings.nav.sftp.label"),           icon: "lucide:folder-closed",    keywords: i18n.t("settings.nav.sftp.keywords",           { returnObjects: true }) as string[] },
    { id: "portForwarding", label: i18n.t("settings.nav.portForwarding.label"), icon: "lucide:arrow-right-left", keywords: i18n.t("settings.nav.portForwarding.keywords", { returnObjects: true }) as string[] },
    { id: "hosts",          label: i18n.t("settings.nav.hosts.label"),          icon: "lucide:server",           keywords: i18n.t("settings.nav.hosts.keywords",          { returnObjects: true }) as string[] },
    { id: "shortcuts",      label: i18n.t("settings.nav.shortcuts.label"),      icon: "lucide:keyboard",         keywords: i18n.t("settings.nav.shortcuts.keywords",      { returnObjects: true }) as string[] },
    { id: "diagnostics",    label: i18n.t("settings.nav.diagnostics.label"),    icon: "lucide:bug",              keywords: i18n.t("settings.nav.diagnostics.keywords",    { returnObjects: true }) as string[] },
    { id: "about",          label: i18n.t("settings.nav.about.label"),          icon: "lucide:info",             keywords: i18n.t("settings.nav.about.keywords",          { returnObjects: true }) as string[] },
  ];
}
