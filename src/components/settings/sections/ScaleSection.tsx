import { useTranslation } from "react-i18next";
import { MAX_UI_SCALE, MIN_UI_SCALE, useUIStore } from "@/stores/uiStore";
import StepperCard from "./StepperCard";

export default function ScaleSection() {
  const { t } = useTranslation();
  const uiScale = useUIStore((s) => s.uiScale);
  const setUiScale = useUIStore((s) => s.setUiScale);

  return (
    <StepperCard
      title={t("settings.appearance.uiScale.title")}
      desc={t("settings.appearance.uiScale.desc")}
      value={Math.round(uiScale * 100)}
      unit="%"
      min={Math.round(MIN_UI_SCALE * 100)}
      max={Math.round(MAX_UI_SCALE * 100)}
      step={1}
      buttonStep={5}
      onChange={(percent) => setUiScale(percent / 100)}
      onReset={() => setUiScale(1)}
      labels={{
        clickHint: t("settings.appearance.uiScale.clickHint"),
        zoomOut: t("settings.appearance.uiScale.zoomOut"),
        zoomIn: t("settings.appearance.uiScale.zoomIn"),
        resetTitle: t("settings.appearance.uiScale.resetTitle"),
        reset: t("settings.appearance.uiScale.reset"),
      }}
    />
  );
}
