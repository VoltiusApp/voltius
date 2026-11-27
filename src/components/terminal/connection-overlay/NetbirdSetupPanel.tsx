import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { NetbirdSettings } from "@/types";
import { NetbirdFields } from "@/components/connections/NetbirdFields";
import { NETBIRD_DEFAULTS, netbirdComplete, normalizeNetbird } from "@/services/netbirdSettings";
import { DecisionPanel } from "./DecisionPanel";

export function NetbirdSetupPanel({ initial, onSubmit, onCancel }: {
  initial?: NetbirdSettings;
  onSubmit: (settings: NetbirdSettings) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(initial ?? NETBIRD_DEFAULTS);
  const normalized = normalizeNetbird(settings);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:bird" width={14} className="text-(--t-text-dim) shrink-0" />}
      title={t("terminal.overlay.netbird.title")}
      description={t("terminal.overlay.netbird.setup")}
      actions={[
        {
          label: t("terminal.overlay.netbird.signIn"),
          disabled: !netbirdComplete(normalized),
          onClick: () => onSubmit(normalized),
        },
        ...(onCancel
          ? [{ label: t("common.action.cancel"), variant: "ghost" as const, dismisses: true, onClick: onCancel }]
          : []),
      ]}
    >
      <div className="w-full max-h-[45dvh] overflow-y-auto">
        <NetbirdFields value={settings} onChange={setSettings} />
      </div>
    </DecisionPanel>
  );
}
