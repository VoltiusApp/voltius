import { useTranslation } from "react-i18next";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { SettingRow, SettingsGroup } from "./shared";

export default function PortForwardingSection() {
  const { t } = useTranslation();
  const [autoForwardEnabled, setAutoForwardEnabled] = useToggle("auto-forward");
  const [autoForwardNotificationsEnabled, setAutoForwardNotificationsEnabled] = useToggle("forwarding-notifications");

  return (
    <div className="p-6 max-w-lg space-y-6">
      <SettingsGroup title={t("settings.portForwarding.automationTitle")} divided>
        <SettingRow
          title={t("settings.portForwarding.autoForward.title")}
          desc={t("settings.portForwarding.autoForward.desc")}
          dirty={autoForwardEnabled !== TOGGLE_DEFS["auto-forward"].default}
          onReset={() => setAutoForwardEnabled(TOGGLE_DEFS["auto-forward"].default)}
        >
          <Toggle checked={autoForwardEnabled} onChange={setAutoForwardEnabled} />
        </SettingRow>
        <SettingRow
          title={t("settings.portForwarding.notifications.title")}
          desc={t("settings.portForwarding.notifications.desc")}
          dimmed={!autoForwardEnabled}
          dirty={autoForwardNotificationsEnabled !== TOGGLE_DEFS["forwarding-notifications"].default}
          onReset={() => setAutoForwardNotificationsEnabled(TOGGLE_DEFS["forwarding-notifications"].default)}
        >
          <Toggle
            checked={autoForwardNotificationsEnabled}
            onChange={setAutoForwardNotificationsEnabled}
            disabled={!autoForwardEnabled}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
