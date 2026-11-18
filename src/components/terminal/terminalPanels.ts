import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { RightPanelSection } from "@/stores/uiStore";
import { usePluginStore } from "@/stores/pluginStore";
import { resolveLabel } from "@/plugins/resolveLabel";
import { useUiLanguage } from "@/i18n";
import { PORT_FORWARDING_ICON, SFTP_ICON } from "@/lib/conceptIcons";
import { orderPluginSections } from "./rightPanelOrder";

export interface TerminalPanel {
  id: RightPanelSection;
  icon: string;
  title: string;
  desktopOnly?: boolean;
}

const PLUGIN_PREFIX = "plugin:";

export const pluginPanelId = (sectionId: string) => `${PLUGIN_PREFIX}${sectionId}` as RightPanelSection;

export function pluginSectionIdOf(panelId: string): string | null {
  return panelId.startsWith(PLUGIN_PREFIX) ? panelId.slice(PLUGIN_PREFIX.length) : null;
}

/** The terminal side panels, in rail order: the desktop rail and the mobile panel menu both list these. */
export function useTerminalPanels(): TerminalPanel[] {
  const { t } = useTranslation();
  const pluginSections = usePluginStore((s) => s.rightPanelSections);
  const locale = useUiLanguage();
  return useMemo(() => [
    { id: "snippets", icon: "lucide:braces", title: t("common.entity.snippets") },
    { id: "history", icon: "lucide:clock", title: t("terminal.rightPanel.sections.history") },
    { id: "notes", icon: "lucide:notebook-pen", title: t("terminal.rightPanel.sections.notes") },
    // Phones pick themes in Settings → Appearance.
    { id: "themes", icon: "lucide:palette", title: t("terminal.rightPanel.themes"), desktopOnly: true },
    { id: "ports", icon: PORT_FORWARDING_ICON, title: t("terminal.ports.header.title") },
    { id: "sftp", icon: SFTP_ICON, title: t("terminal.rightPanel.sections.sftp") },
    ...orderPluginSections([...pluginSections.values()]).map((s) => ({
      id: pluginPanelId(s.id),
      icon: s.icon ?? "lucide:puzzle",
      title: resolveLabel(s.label),
    })),
  ], [pluginSections, t, locale]);
}
