import { useTranslation } from "react-i18next";
import { connectionLabel, useTmuxHostActions } from "@/components/connections/useTmuxHostActions";
import { useTmuxPinVersion } from "@/services/tmuxInstall";
import { useConnectionStore } from "@/stores/connectionStore";
import { useHostMuxStore } from "@/stores/hostMuxStore";
import { SETTINGS_ROW_BUTTON, SettingRow, SettingsGroup } from "./shared";

function VoltiusTmuxRow({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation();
  const voltius = useHostMuxStore((s) => s.hosts[connectionId]?.voltius);
  const installing = useHostMuxStore((s) => s.installing[connectionId]);
  const pin = useTmuxPinVersion();
  const { live, hostName, gate, install, askRemove, removeModal } = useTmuxHostActions(connectionId);
  if (!voltius) return null;

  const parts = voltius.active ? [t("settings.hosts.voltiusTmux.desc", { active: voltius.active })] : [];
  if (voltius.outdated && pin) parts.push(t("settings.hosts.voltiusTmux.available", { pin }));
  for (const [old, count] of Object.entries(voltius.inUse)) {
    if (old !== voltius.active && count > 0) parts.push(t("settings.hosts.voltiusTmux.stillUsed", { old, count }));
  }

  const button = (label: string, onClick: () => void) => (
    <button type="button" className={SETTINGS_ROW_BUTTON} disabled={!live || !!installing} title={installing ? undefined : gate} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <>
      <SettingRow title={hostName} desc={parts.join(" · ")}>
        {voltius.outdated &&
          button(t(installing ? "settings.hosts.voltiusTmux.installing" : "settings.hosts.voltiusTmux.updateNow"), install)}
        {button(t("connections.form.mux.remove"), askRemove)}
      </SettingRow>
      {removeModal}
    </>
  );
}

export function VoltiusTmuxGroup() {
  const { t } = useTranslation();
  const withCopy = useHostMuxStore((s) => Object.keys(s.hosts).filter((id) => s.hosts[id].voltius).join("\n"));
  const ids = useConnectionStore((s) => withCopy.split("\n").filter((id) => id && connectionLabel(s, id)).join("\n"));
  if (!ids) return null;
  return (
    <SettingsGroup title={t("settings.hosts.voltiusTmux.title")} divided>
      {ids.split("\n").map((id) => (
        <VoltiusTmuxRow key={id} connectionId={id} />
      ))}
    </SettingsGroup>
  );
}
