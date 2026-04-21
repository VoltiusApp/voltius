import type { UITheme, TerminalTheme } from "@/themes/types";

export const UI_GROUPS: { label: string; fields: (keyof UITheme)[] }[] = [
  {
    label: "Backgrounds",
    fields: ["bgTerminal", "bgBase", "bgSidebar", "bgCard", "bgCardHover", "bgCardAvatar", "bgInput", "bgInputHover", "bgElevated", "bgModal"],
  },
  { label: "Borders", fields: ["border", "borderHover"] },
  {
    label: "Text",
    fields: ["textDim", "textMuted", "textSecondary", "textPrimary", "textBright"],
  },
  {
    label: "Accent & Tabs",
    fields: ["accent", "accentHover", "tabBg", "tabActiveBg", "tabActiveText", "tabActiveBorder"],
  },
  {
    label: "Vault Tabs",
    fields: ["vaultTabBg", "vaultTabActiveBg"],
  },
  {
    label: "Status",
    fields: ["statusConnected", "statusError", "statusConnecting", "statusWarning"],
  },
  {
    label: "Other",
    fields: ["textNotice"],
  },
];

export const TERMINAL_GROUPS: { label: string; fields: (keyof TerminalTheme)[] }[] = [
  {
    label: "Terminal Base",
    fields: ["background", "foreground", "cursor", "selectionBackground"],
  },
  {
    label: "ANSI Colors",
    fields: ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"],
  },
  {
    label: "Bright ANSI Colors",
    fields: ["brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"],
  },
];

export const FIELD_LABELS: Record<string, string> = {
  bgTerminal: "Terminal / Titlebar", bgBase: "Base Background", bgSidebar: "Sidebar",
  bgCard: "Cards", bgCardHover: "Cards Hover", bgCardAvatar: "Card Avatar",
  bgInput: "Inputs", bgInputHover: "Inputs Hover", bgElevated: "Elevated / Hover", bgModal: "Modal / Panel",
  border: "Border", borderHover: "Border Hover",
  textDim: "Text Dim", textMuted: "Text Muted", textSecondary: "Text Secondary",
  textPrimary: "Text Primary", textBright: "Text Bright",
  accent: "Accent", accentHover: "Accent Hover",
  tabBg: "Tab Bg", tabActiveBg: "Tab Active Bg", tabActiveText: "Tab Active Text", tabActiveBorder: "Tab Active Border",
  vaultTabBg: "Vault Tab Bg", vaultTabActiveBg: "Vault Tab Active Bg",
  statusConnected: "Connected", statusError: "Error", statusConnecting: "Connecting", statusWarning: "Warning",
  textNotice: "Notice Text",
  background: "Background", foreground: "Foreground", cursor: "Cursor",
  selectionBackground: "Selection",
  black: "Black", red: "Red", green: "Green", yellow: "Yellow",
  blue: "Blue", magenta: "Magenta", cyan: "Cyan", white: "White",
  brightBlack: "Bright Black", brightRed: "Bright Red", brightGreen: "Bright Green",
  brightYellow: "Bright Yellow", brightBlue: "Bright Blue", brightMagenta: "Bright Magenta",
  brightCyan: "Bright Cyan", brightWhite: "Bright White",
};
