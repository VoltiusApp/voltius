import { useTranslation } from "react-i18next";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE, useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import StepperCard from "./StepperCard";
import { mobileKey } from "@/components/settings/settingsMobileCore";
import { useIsMobile } from "@/utils/platform";

export default function TerminalFontSizeSection() {
  const { t } = useTranslation();
  const setTerminalFontSize = useUIStore((s) => s.setTerminalFontSize);
  const override = useUIStore((s) => s.terminalFontSize);
  const themeFontSize = useThemeStore((s) => s.getActiveTheme().terminalFontSize);
  const fontSize = override ?? themeFontSize;
  const isMobile = useIsMobile();

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
      dirty={override != null}
      labels={{
        clickHint: t(mobileKey("settings.appearance.terminalFontSize.clickHint", isMobile)),
        zoomOut: t("settings.appearance.terminalFontSize.zoomOut"),
        zoomIn: t("settings.appearance.terminalFontSize.zoomIn"),
        resetTitle: t("settings.appearance.terminalFontSize.resetTitle"),
        reset: t("settings.appearance.terminalFontSize.reset"),
      }}
    />
  );
}
