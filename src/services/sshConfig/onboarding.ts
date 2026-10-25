import i18n from "@/i18n";
import { log } from "@/lib/logger";
import { whenLoginSyncSettled } from "@/services/loginSyncGate";
import { parseOpensshFiles, readOpensshFiles } from "@/services/import-export/parsers/openssh";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";
import { getPlatform, isMobilePlatform } from "@/utils/platform";
import { migrateFromPlugin } from "./migrate";
import { showMigrationNotice } from "./notice";
import { loadSshConfigState, updateSshConfigState, type SshConfigState } from "./state";
import { startSshConfigSyncEngine } from "./sync";

async function hostCount(): Promise<number> {
  return parseOpensshFiles(await readOpensshFiles()).hosts.length;
}

export function startSshConfigOnboarding(): () => void {
  let disposed = false;
  let bannerId: string | undefined;
  let stopEngine: (() => void) | undefined;
  const dismiss = () => { if (bannerId) useNotificationStore.getState().dismissBanner(bannerId); };
  const answer = (offer: SshConfigState["offer"]) =>
    updateSshConfigState({ offer }).catch((e) => log.error("ssh-config offer answer not saved", e));

  void (async () => {
    await whenLoginSyncSettled();
    if (disposed) return;
    await loadSshConfigState();
    if (disposed || isMobilePlatform(await getPlatform())) return;
    await migrateFromPlugin().catch((e) => log.error("ssh-config migration failed", e));
    if (disposed) return;
    stopEngine = startSshConfigSyncEngine();
    const current = await loadSshConfigState();
    if (disposed) return;
    if (current.notice === "pending") showMigrationNotice();
    if (current.offer || current.sync?.on) return;
    const count = await hostCount().catch(() => 0);
    if (disposed || count === 0) return;
    bannerId = useNotificationStore.getState().addBanner({
      source: APP_SOURCE,
      message: i18n.t("notifications.sshConfigOffer.message", { count }),
      severity: "info",
      dismissable: true,
      actions: [
        { label: i18n.t("notifications.sshConfigOffer.import"), onClick: () => {
          void answer("accepted");
          useUIStore.getState().openImportExport("import", { source: "openssh", autoTrigger: true });
        } },
        { label: i18n.t("notifications.sshConfigOffer.skip"), onClick: () => void answer("declined") },
      ],
    });
  })().catch((e) => log.error("ssh-config onboarding failed", e));

  return () => {
    disposed = true;
    dismiss();
    stopEngine?.();
  };
}
