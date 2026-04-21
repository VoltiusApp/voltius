export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string;
  brightYellow: string; brightBlue: string; brightMagenta: string;
  brightCyan: string; brightWhite: string;
}

export interface UITheme {
  bgTerminal: string;    // titlebar + terminal bg
  bgBase: string;        // homepage/main bg
  bgSidebar: string;     // sidebar
  bgCard: string;        // host cards
  bgCardHover: string;   // host cards hovered
  bgCardAvatar: string;  // host card default avatar bg
  bgInput: string;       // inputs/search
  bgInputHover: string;  // buttons/inputs hovered
  bgElevated: string;    // hover states / elevated surfaces
  bgModal: string;       // omni/modal bg
  border: string;
  borderHover: string;
  textDim: string;       // dimmest (placeholders)
  textMuted: string;     // icons, secondary
  textSecondary: string;
  textPrimary: string;
  textBright: string;
  accent: string;
  accentHover: string;
  tabBg: string;             // inactive SSH tab background
  tabActiveBg: string;
  tabActiveText: string;
  tabActiveBorder: string;
  vaultTabBg: string;        // vault/home tab — inactive background
  vaultTabActiveBg: string;  // vault/home tab — active background
  statusConnected: string;
  statusError: string;
  statusConnecting: string;
  statusWarning: string;
  textNotice: string;       // notice/info boxes text and icon
}

export interface AppTheme {
  id: string;
  name: string;
  builtIn: boolean;
  uiFontFamily: string;
  uiFontSize: number;
  terminalFontFamily: string;
  terminalFontSize: number;
  ui: UITheme;
  terminal: TerminalTheme;
}
