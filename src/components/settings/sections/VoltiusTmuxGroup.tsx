import { useTranslation } from "react-i18next";
import { useTmuxHostActions } from "@/components/connections/useTmuxHostActions";
import { useTmuxPinVersion } from "@/services/tmuxInstall";
import { useHostMuxStore } from "@/stores/hostMuxStore";
import { SETTINGS_ROW_BUTTON, SettingRow, SettingsGroup } from "./shared";

function VoltiusTmuxRow({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation();
  const voltius = useHostMuxStore((s) => s.hosts[connectionId]?.voltius);
  const installing = useHostMuxStore((s) => s.installing[connectionId]);
  const pin = useTmuxPinVersion();
  const { live, hostName, gate, install, askRemove, removeModal } = useTmuxHostActions(connectionId);
  if (!voltius) return null;

  const parts = [t("settings.hosts.voltiusTmux.desc", { active: voltius.active })];
  if (voltius.outdated && pin) parts.push(t("settings.hosts.voltiusTmux.available", { pin }));
  for (const [old, count] of Object.entries(voltius.inUse)) {
    if (old !== voltius.active && count > 0) parts.push(t("settings.hosts.voltiusTmux.stillUsed", { old, count }));
  }

  const update = voltius.outdated;
  const label = installing
    ? t("settings.hosts.voltiusTmux.installing")
    : update
      ? t("settings.hosts.voltiusTmux.updateNow")
      : t("connections.form.mux.remove");

  return (
    <>
      <SettingRow title={hostName || connectionId} desc={parts.join(" · ")}>
        <button
          type="button"
          className={SETTINGS_ROW_BUTTON}
          disabled={!live || !!installing}
          title={installing ? undefined : gate}
          onClick={update ? install : askRemove}
        >
          {label}
        </button>
      </SettingRow>
      {removeModal}
    </>
  );
}

export function VoltiusTmuxGroup() {
  const { t } = useTranslation();
  const ids = useHostMuxStore((s) => Object.keys(s.hosts).filter((id) => s.hosts[id].voltius).join("\n"));
  if (!ids) return null;
  return (
    <SettingsGroup title={t("settings.hosts.voltiusTmux.title")} divided>
      {ids.split("\n").map((id) => (
        <VoltiusTmuxRow key={id} connectionId={id} />
      ))}
    </SettingsGroup>
  );
}
