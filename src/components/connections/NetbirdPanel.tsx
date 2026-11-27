import { useTranslation } from "react-i18next";
import type { NetbirdSettings } from "@/types";
import { NETBIRD_DEFAULTS } from "@/services/netbirdSettings";
import { SlideOverHeader } from "@/components/shared/slideOver";
import { Toggle } from "@/components/shared/Toggle";
import { NetbirdFields } from "./NetbirdFields";
import { FormHint, SettingRow } from "./formShared";

export default function NetbirdPanel({ settings, onChange, onBack }: {
  settings: NetbirdSettings | undefined;
  onChange: (next: NetbirdSettings | undefined) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full overflow-hidden bg-(--t-bg-card)">
      <SlideOverHeader icon="lucide:bird" title={t("connections.netbird.title")} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        <SettingRow icon="lucide:power" label={t("connections.netbird.enable")}>
          <Toggle checked={!!settings} onChange={(on) => onChange(on ? NETBIRD_DEFAULTS : undefined)} />
        </SettingRow>
        <FormHint>{t("connections.netbird.hint")}</FormHint>
        {settings && <NetbirdFields value={settings} onChange={onChange} />}
      </div>
    </div>
  );
}
