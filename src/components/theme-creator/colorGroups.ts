import type { TFunction } from "i18next";
import type { UITheme, TerminalTheme } from "@/themes/types";

export function getUiGroups(t: TFunction): { label: string; fields: (keyof UITheme)[] }[] {
  return [
    {
      label: t("themeCreator.groups.backgrounds"),
      fields: ["bgTerminal", "bgStatusBar", "bgBase", "bgToolbar", "bgCard", "bgCardHover", "bgCardAvatar", "bgInput", "bgInputHover", "bgElevated", "bgModal"],
    },
    { label: t("themeCreator.groups.borders"), fields: ["border", "borderHover"] },
    {
      label: t("themeCreator.groups.text"),
      fields: ["textDim", "textMuted", "textSecondary", "textPrimary", "textBright"],
    },
    {
      label: t("themeCreator.groups.accentAndTabs"),
      fields: ["accent", "accentHover", "tabBg", "tabActiveBg", "tabActiveText", "tabActiveBorder"],
    },
    {
      label: t("themeCreator.groups.vaultTabs"),
      fields: ["vaultTabBg", "vaultTabActiveBg"],
    },
    {
      label: t("themeCreator.groups.status"),
      fields: ["statusConnected", "statusError", "statusConnecting", "statusWarning"],
    },
    {
      label: t("themeCreator.groups.other"),
      fields: ["textNotice"],
    },
  ];
}

export const OPTIONAL_TERMINAL_FIELDS: ReadonlySet<keyof TerminalTheme> = new Set(["selectionForeground"]);

export function getTerminalGroups(t: TFunction): { label: string; fields: (keyof TerminalTheme)[] }[] {
  return [
    {
      label: t("themeCreator.groups.terminalBase"),
      fields: ["background", "foreground", "cursor", "selectionBackground", "selectionForeground"],
    },
    {
      label: t("themeCreator.groups.ansiColors"),
      fields: ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"],
    },
    {
      label: t("themeCreator.groups.brightAnsiColors"),
      fields: ["brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"],
    },
  ];
}

export function getFieldLabels(t: TFunction): Record<string, string> {
  return {
    bgTerminal: t("themeCreator.fields.bgTerminal"), bgStatusBar: t("themeCreator.fields.bgStatusBar"), bgBase: t("themeCreator.fields.bgBase"), bgToolbar: t("themeCreator.fields.bgToolbar"),
    bgCard: t("themeCreator.fields.bgCard"), bgCardHover: t("themeCreator.fields.bgCardHover"), bgCardAvatar: t("themeCreator.fields.bgCardAvatar"),
    bgInput: t("themeCreator.fields.bgInput"), bgInputHover: t("themeCreator.fields.bgInputHover"), bgElevated: t("themeCreator.fields.bgElevated"), bgModal: t("themeCreator.fields.bgModal"),
    border: t("themeCreator.fields.border"), borderHover: t("themeCreator.fields.borderHover"),
    textDim: t("themeCreator.fields.textDim"), textMuted: t("themeCreator.fields.textMuted"), textSecondary: t("themeCreator.fields.textSecondary"),
    textPrimary: t("themeCreator.fields.textPrimary"), textBright: t("themeCreator.fields.textBright"),
    accent: t("themeCreator.fields.accent"), accentHover: t("themeCreator.fields.accentHover"),
    tabBg: t("themeCreator.fields.tabBg"), tabActiveBg: t("themeCreator.fields.tabActiveBg"), tabActiveText: t("themeCreator.fields.tabActiveText"), tabActiveBorder: t("themeCreator.fields.tabActiveBorder"),
    vaultTabBg: t("themeCreator.fields.vaultTabBg"), vaultTabActiveBg: t("themeCreator.fields.vaultTabActiveBg"),
    statusConnected: t("themeCreator.fields.statusConnected"), statusError: t("themeCreator.fields.statusError"), statusConnecting: t("themeCreator.fields.statusConnecting"), statusWarning: t("themeCreator.fields.statusWarning"),
    textNotice: t("themeCreator.fields.textNotice"),
    background: t("themeCreator.fields.background"), foreground: t("themeCreator.fields.foreground"), cursor: t("themeCreator.fields.cursor"),
    selectionBackground: t("themeCreator.fields.selectionBackground"),
    selectionForeground: t("themeCreator.fields.selectionForeground"),
    black: t("themeCreator.fields.black"), red: t("themeCreator.fields.red"), green: t("themeCreator.fields.green"), yellow: t("themeCreator.fields.yellow"),
    blue: t("themeCreator.fields.blue"), magenta: t("themeCreator.fields.magenta"), cyan: t("themeCreator.fields.cyan"), white: t("themeCreator.fields.white"),
    brightBlack: t("themeCreator.fields.brightBlack"), brightRed: t("themeCreator.fields.brightRed"), brightGreen: t("themeCreator.fields.brightGreen"),
    brightYellow: t("themeCreator.fields.brightYellow"), brightBlue: t("themeCreator.fields.brightBlue"), brightMagenta: t("themeCreator.fields.brightMagenta"),
    brightCyan: t("themeCreator.fields.brightCyan"), brightWhite: t("themeCreator.fields.brightWhite"),
  };
}
