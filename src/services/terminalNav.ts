import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { isMobileShell } from "@/utils/platform";

/** Bring the terminal screen forward in whichever shell is running; the two navigate through different stores. */
export function showTerminalNav(): void {
  if (isMobileShell()) {
    useUIStore.getState().setNotificationCenterOpen(false);
    useMobileNavStore.getState().setTab("terminal");
    return;
  }
  useUIStore.getState().setActiveNav("terminal");
}
