import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { SettingRow, SettingsGroup } from "@/components/settings/sections/shared";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { managedCount, useSshConfigStore } from "@/stores/sshConfigStore";
import { changeSync, turnOff } from "@/services/sshConfig/link";
import { sshConfigSync } from "@/services/sshConfig/sync";
import { isMobilePlatform, usePlatform } from "@/utils/platform";
import { statusLine } from "./statusLine";
import { usePersonalVaultOptions } from "./vaultOptions";

export function SshConfigGroup() {
  const { t } = useTranslation();
  const platform = usePlatform();
  const sync = useSshConfigStore((s) => s.state.sync);
  const managed = useSshConfigStore((s) => managedCount(s.state));
  const status = useSshConfigStore((s) => s.status);
  const openDialog = useSshConfigStore((s) => s.openDialog);
  const vaultOptions = usePersonalVaultOptions(sync?.vault);
  const [confirmOff, setConfirmOff] = useState(false);
  if (!platform || isMobilePlatform(platform)) return null;

  const on = !!sync?.on;
  const reviewed = status.error !== "join";

  return (
    <SettingsGroup title="~/.ssh/config" divided>
      <SettingRow title={t("settings.hosts.sshConfig.switch.title")} desc={t("settings.hosts.sshConfig.switch.desc")}>
        <Toggle
          checked={on}
          aria-label={t("settings.hosts.sshConfig.switch.title")}
          onChange={(v) => (v ? openDialog("activate") : setConfirmOff(true))}
        />
      </SettingRow>
      {on && !reviewed && (
        <SettingRow title={t("settings.hosts.sshConfig.here.title")} desc={t("settings.hosts.sshConfig.here.desc")}>
          <button className="btn btn-primary px-3 py-1.5 rounded-lg text-xs font-medium" onClick={() => openDialog("activate")}>
            {t("settings.hosts.sshConfig.here.action")}
          </button>
        </SettingRow>
      )}
      {on && reviewed && sync && (
        <>
          <SettingRow
            title={t("settings.hosts.sshConfig.vault.title")}
            desc={
              <>
                {t("settings.hosts.sshConfig.vault.desc")}
                {status.error === "vault" && (
                  <span className="block" style={{ color: "var(--t-status-error)" }}>{t("notifications.sshConfigSync.vaultGone")}</span>
                )}
              </>
            }
          >
            <FormSelect value={sync.vault} options={vaultOptions} onChange={(vault) => void changeSync({ vault })} />
          </SettingRow>
          <SettingRow title={t("settings.hosts.sshConfig.keys.switch")} desc={t("settings.hosts.sshConfig.keys.settingDesc")}>
            <Toggle
              checked={sync.copyKeys !== false}
              aria-label={t("settings.hosts.sshConfig.keys.switch")}
              onChange={(copyKeys) => void changeSync({ copyKeys })}
            />
          </SettingRow>
          <SettingRow
            title={t("settings.hosts.sshConfig.status.title")}
            desc={statusLine(t, status.lastRead, managed, status.skipped.length)}
          >
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs font-medium" onClick={() => openDialog("review")}>
                {t("settings.hosts.sshConfig.status.view")}
              </button>
              <button
                className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                onClick={() => void sshConfigSync.request("manual")}
              >
                <Icon icon="lucide:refresh-cw" width={12} />
                {t("settings.hosts.sshConfig.status.syncNow")}
              </button>
            </div>
          </SettingRow>
        </>
      )}
      {confirmOff && (
        <ConfirmModal
          tone="warning"
          title={t("settings.hosts.sshConfig.off.title")}
          message={t("settings.hosts.sshConfig.off.message", { count: managed })}
          confirmLabel={t("settings.hosts.sshConfig.off.confirm")}
          onConfirm={() => { setConfirmOff(false); void turnOff(); }}
          onCancel={() => setConfirmOff(false)}
        />
      )}
    </SettingsGroup>
  );
}
