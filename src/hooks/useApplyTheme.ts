import { useEffect } from "react";
import { useThemeStore } from "@/stores/themeStore";
import type { AppTheme } from "@/themes/types";

export function applyThemeToDom(theme: AppTheme) {
  const root = document.documentElement;
  const ui = theme.ui;
  root.style.setProperty("--t-bg-terminal", ui.bgTerminal);
  root.style.setProperty("--t-bg-base", ui.bgBase);
  root.style.setProperty("--t-bg-sidebar", ui.bgSidebar);
  root.style.setProperty("--t-bg-card", ui.bgCard);
  root.style.setProperty("--t-bg-card-hover", ui.bgCardHover);
  root.style.setProperty("--t-bg-card-avatar", ui.bgCardAvatar);
  root.style.setProperty("--t-bg-input", ui.bgInput);
  root.style.setProperty("--t-bg-input-hover", ui.bgInputHover);
  root.style.setProperty("--t-bg-elevated", ui.bgElevated);
  root.style.setProperty("--t-bg-modal", ui.bgModal);
  root.style.setProperty("--t-border", ui.border);
  root.style.setProperty("--t-border-hover", ui.borderHover);
  root.style.setProperty("--t-text-dim", ui.textDim);
  root.style.setProperty("--t-text-muted", ui.textMuted);
  root.style.setProperty("--t-text-secondary", ui.textSecondary);
  root.style.setProperty("--t-text-primary", ui.textPrimary);
  root.style.setProperty("--t-text-bright", ui.textBright);
  root.style.setProperty("--t-accent", ui.accent);
  root.style.setProperty("--t-accent-hover", ui.accentHover);
  root.style.setProperty("--t-tab-bg", ui.tabBg);
  root.style.setProperty("--t-tab-active-bg", ui.tabActiveBg);
  root.style.setProperty("--t-tab-active-text", ui.tabActiveText);
  root.style.setProperty("--t-tab-active-border", ui.tabActiveBorder);
  root.style.setProperty("--t-vault-tab-bg", ui.vaultTabBg);
  root.style.setProperty("--t-vault-tab-active-bg", ui.vaultTabActiveBg);
  root.style.setProperty("--t-status-connected", ui.statusConnected);
  root.style.setProperty("--t-status-error", ui.statusError);
  root.style.setProperty("--t-status-connecting", ui.statusConnecting);
  root.style.setProperty("--t-status-warning", ui.statusWarning);
  root.style.setProperty("--t-text-notice", ui.textNotice);
  root.style.setProperty("--t-font-family", theme.uiFontFamily);
  root.style.setProperty("--t-font-size", `${theme.uiFontSize}px`);
  root.style.setProperty("--t-terminal-font-family", theme.terminalFontFamily);
  root.style.setProperty("--t-terminal-font-size", `${theme.terminalFontSize}px`);
  window.dispatchEvent(new CustomEvent("theme-preview", { detail: theme }));
}

export function useApplyTheme() {
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const customThemes = useThemeStore((s) => s.customThemes);

  useEffect(() => {
    applyThemeToDom(getActiveTheme());
  }, [activeThemeId, customThemes, getActiveTheme]);
}
