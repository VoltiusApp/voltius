import { useTranslation } from "react-i18next";
import { MAX_TAB_FONT_SIZE, MIN_TAB_FONT_SIZE, useUIStore } from "@/stores/uiStore";
import StepperCard from "./StepperCard";
import { mobileKey } from "@/components/settings/settingsMobileCore";
import { useIsMobile } from "@/utils/platform";

/** The tabs' text is 16px unless overridden. */
export const DEFAULT_TAB_FONT_SIZE = 16;

export default function TabFontSizeSection() {
  const { t } = useTranslation();
  const setTabFontSize = useUIStore((s) => s.setTabFontSize);
  const override = useUIStore((s) => s.tabFontSize);
  const isMobile = useIsMobile();

  return (
    <StepperCard
      title={t("settings.appearance.tabFontSize.title")}
      desc={t("settings.appearance.tabFontSize.desc")}
      value={override ?? DEFAULT_TAB_FONT_SIZE}
      unit="px"
      min={MIN_TAB_FONT_SIZE}
      max={MAX_TAB_FONT_SIZE}
      step={1}
      onChange={setTabFontSize}
      onReset={() => setTabFontSize(null)}
      dirty={override != null}
      labels={{
        clickHint: t(mobileKey("settings.appearance.tabFontSize.clickHint", isMobile)),
        zoomOut: t("settings.appearance.tabFontSize.zoomOut"),
        zoomIn: t("settings.appearance.tabFontSize.zoomIn"),
        resetTitle: t("settings.appearance.tabFontSize.resetTitle"),
        reset: t("settings.appearance.tabFontSize.reset"),
      }}
    />
  );
}
