import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { isMobileShell } from "@/utils/platform";

export function openPortForwardingPage(): void {
  if (isMobileShell()) {
    const nav = useMobileNavStore.getState();
    const top = nav.stack[nav.stack.length - 1];
    if (top?.kind !== "more-page" || top.page !== "port-forwarding") nav.push({ kind: "more-page", page: "port-forwarding" });
    return;
  }
  const ui = useUIStore.getState();
  ui.setActiveNav("port-forwarding");
  ui.setHomeView(false);
}
