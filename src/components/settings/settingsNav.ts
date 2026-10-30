import type { SettingsSection } from "@/stores/uiStore";
import i18n from "@/i18n";

export function getSettingsNav(): {
  id: SettingsSection;
  label: string;
  /** One-line summary under the label in the Android settings list. */
  sub?: string;
  icon: string;
  keywords?: string[];
}[] {
  return [
    { id: "appearance",     label: i18n.t("settings.nav.appearance.label"),     sub: i18n.t("settings.nav.appearance.mobileSub", { defaultValue: "" }), icon: "lucide:palette",          keywords: i18n.t("settings.nav.appearance.keywords",     { returnObjects: true }) as string[] },
    { id: "account",        label: i18n.t("settings.nav.account.label"),        sub: i18n.t("settings.nav.account.mobileSub", { defaultValue: "" }), icon: "lucide:circle-user",      keywords: i18n.t("settings.nav.account.keywords",        { returnObjects: true }) as string[] },
    { id: "sync",           label: i18n.t("settings.nav.sync.label"),           sub: i18n.t("settings.nav.sync.mobileSub", { defaultValue: "" }), icon: "lucide:cloud",            keywords: i18n.t("settings.nav.sync.keywords",           { returnObjects: true }) as string[] },
    { id: "plugins",        label: i18n.t("settings.nav.plugins.label"),        sub: i18n.t("settings.nav.plugins.mobileSub", { defaultValue: "" }), icon: "lucide:puzzle",           keywords: i18n.t("settings.nav.plugins.keywords",        { returnObjects: true }) as string[] },
    { id: "integrations",   label: i18n.t("settings.nav.integrations.label"),   sub: i18n.t("settings.nav.integrations.mobileSub", { defaultValue: "" }), icon: "lucide:plug",             keywords: i18n.t("settings.nav.integrations.keywords",   { returnObjects: true }) as string[] },
    { id: "terminal",       label: i18n.t("settings.nav.terminal.label"),       sub: i18n.t("settings.nav.terminal.mobileSub", { defaultValue: "" }), icon: "lucide:square-terminal",  keywords: i18n.t("settings.nav.terminal.keywords",       { returnObjects: true }) as string[] },
    { id: "sftp",           label: i18n.t("settings.nav.sftp.label"),           sub: i18n.t("settings.nav.sftp.mobileSub", { defaultValue: "" }), icon: "lucide:folder-closed",    keywords: i18n.t("settings.nav.sftp.keywords",           { returnObjects: true }) as string[] },
    { id: "portForwarding", label: i18n.t("settings.nav.portForwarding.label"), sub: i18n.t("settings.nav.portForwarding.mobileSub", { defaultValue: "" }), icon: "lucide:arrow-right-left", keywords: i18n.t("settings.nav.portForwarding.keywords", { returnObjects: true }) as string[] },
    { id: "hosts",          label: i18n.t("settings.nav.hosts.label"),          sub: i18n.t("settings.nav.hosts.mobileSub", { defaultValue: "" }), icon: "lucide:server",           keywords: i18n.t("settings.nav.hosts.keywords",          { returnObjects: true }) as string[] },
    { id: "devices",        label: i18n.t("settings.nav.devices.label"),        sub: i18n.t("settings.nav.devices.mobileSub", { defaultValue: "" }), icon: "lucide:monitor-smartphone", keywords: i18n.t("settings.nav.devices.keywords",       { returnObjects: true }) as string[] },
    { id: "shortcuts",      label: i18n.t("settings.nav.shortcuts.label"),      sub: i18n.t("settings.nav.shortcuts.mobileSub", { defaultValue: "" }), icon: "lucide:keyboard",         keywords: i18n.t("settings.nav.shortcuts.keywords",      { returnObjects: true }) as string[] },
    { id: "diagnostics",    label: i18n.t("settings.nav.diagnostics.label"),    sub: i18n.t("settings.nav.diagnostics.mobileSub", { defaultValue: "" }), icon: "lucide:bug",              keywords: i18n.t("settings.nav.diagnostics.keywords",    { returnObjects: true }) as string[] },
    { id: "about",          label: i18n.t("settings.nav.about.label"),          sub: i18n.t("settings.nav.about.mobileSub", { defaultValue: "" }), icon: "lucide:info",             keywords: i18n.t("settings.nav.about.keywords",          { returnObjects: true }) as string[] },
  ];
}
