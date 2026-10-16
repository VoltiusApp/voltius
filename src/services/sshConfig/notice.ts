import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { openActivationReview } from "@/stores/sshConfigStore";
import { notifyOneShot } from "@/services/teamInbox";
import { updateSshConfigState } from "./state";

const ID = "ssh-config-migrated";

async function markSeen(): Promise<void> {
  await updateSshConfigState({ notice: "seen" });
  useNotificationStore.getState().retractInbox(ID);
}

export function showMigrationNotice(): void {
  notifyOneShot(ID, "sshConfigMigrated", i18n.t("notifications.inbox.sshConfigMigrated.message"), [
    { label: i18n.t("notifications.inbox.sshConfigMigrated.turnOnSync"), run: async () => {
      openActivationReview();
      await markSeen();
    } },
    { label: i18n.t("notifications.inbox.sshConfigMigrated.dismiss"), run: markSeen },
  ]);
}
