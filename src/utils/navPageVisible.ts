import { useUIStore, type NavItem } from "@/stores/uiStore";

// The SFTP panel covers the page without changing activeNav, and its own keys must not reach it.
export function isNavPageVisible(navItem: NavItem): boolean {
  const { activeNav, sftpPanelOpen } = useUIStore.getState();
  return activeNav === navItem && !sftpPanelOpen;
}
