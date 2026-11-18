import { startTrialOrCheckout } from "@/services/promos";
import { setSyncPaused } from "@/services/sync";
import { useUIStore } from "@/stores/uiStore";
import type { SyncProviderAction } from "./syncProviders";

export function runSyncProviderAction(action: SyncProviderAction): void {
  const ui = useUIStore.getState();
  switch (action.kind) {
    case "signIn":
      ui.openCloudAuth("signin");
      return;
    case "upgrade":
      void startTrialOrCheckout("pro", "sync_provider", "sync");
      return;
    case "pause":
    case "resume":
      setSyncPaused(action.kind === "pause");
      return;
    case "enable":
      ui.openSettings("plugins");
      return;
    case "configure":
      ui.openSettings("plugins", action.pageId ?? undefined);
      return;
    case "showDevices":
      ui.openSettings("sync");
      return;
  }
}
