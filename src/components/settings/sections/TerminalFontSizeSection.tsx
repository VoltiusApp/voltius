import { useTranslation } from "react-i18next";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE, useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import StepperCard from "./StepperCard";

export default function TerminalFontSizeSection() {
  const { t } = useTranslation();
  const setTerminalFontSize = useUIStore((s) => s.setTerminalFontSize);
  const override = useUIStore((s) => s.terminalFontSize);
  const themeFontSize = useThemeStore((s) => s.getActiveTheme().terminalFontSize);
  const fontSize = override ?? themeFontSize;

  return (
    <StepperCard
      title={t("settings.appearance.terminalFontSize.title")}
      desc={t("settings.appearance.terminalFontSize.desc")}
      value={fontSize}
      unit="px"
      min={MIN_TERMINAL_FONT_SIZE}
      max={MAX_TERMINAL_FONT_SIZE}
      step={1}
      onChange={setTerminalFontSize}
      onReset={() => setTerminalFontSize(null)}
      labels={{
        clickHint: t("settings.appearance.terminalFontSize.clickHint"),
        zoomOut: t("settings.appearance.terminalFontSize.zoomOut"),
        zoomIn: t("settings.appearance.terminalFontSize.zoomIn"),
        resetTitle: t("settings.appearance.terminalFontSize.resetTitle"),
        reset: t("settings.appearance.terminalFontSize.reset"),
      }}
    />
  );
}
