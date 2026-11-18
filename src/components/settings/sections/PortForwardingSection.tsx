import { useTranslation } from "react-i18next";
import { Setting } from "@/components/settings/Setting";
import { SettingsGroup } from "./shared";

export default function PortForwardingSection() {
  const { t } = useTranslation();

  return (
    <div className="p-6 space-y-6">
      <SettingsGroup title={t("settings.portForwarding.automationTitle")} divided>
        <Setting id="toggles.auto-forward" />
        <Setting id="toggles.forwarding-notifications" />
      </SettingsGroup>
    </div>
  );
}
