import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { buildQuickConnectConnection, type QuickConnectIntent } from "@/services/quickConnect";

function goToTerminal(): void {
  const ui = useUIStore.getState();
  ui.setSidebarOpen(false);
  ui.setSftpPanelOpen(false);
  ui.setActiveNav("terminal");
}

/** Connect to a saved host by id, then switch to the terminal view. */
export function launchHost(connectionId: string): void {
  useSessionStore.getState().connect(connectionId).catch(() => {});
  goToTerminal();
}

/** Launch an SSH/serial/local quick-connect intent, then switch to the terminal view. */
export function launchQuickConnect(intent: Exclude<QuickConnectIntent, null>): void {
  const s = useSessionStore.getState();
  if (intent.kind === "ssh") {
    s.connectDirect(buildQuickConnectConnection(intent)).catch(() => {});
  } else if (intent.kind === "serial") {
    s.connectSerialEphemeral(intent.port).catch(() => {});
  } else {
    if (intent.shell) s.beginLocalSession(intent.shell);
    else s.connectLocal().catch(() => {});
  }
  goToTerminal();
}

/** Open a plain local shell, then switch to the terminal view. */
export function launchLocal(): void {
  useSessionStore.getState().connectLocal().catch(() => {});
  goToTerminal();
}

/**
 * Open a local terminal for a specific shell path (e.g. /bin/zsh). Falls back
 * to the preferred/default shell when no path is given.
 */
export function launchLocalShell(shellPath?: string): void {
  const s = useSessionStore.getState();
  if (shellPath) s.beginLocalSession(shellPath);
  else s.connectLocal().catch(() => {});
  goToTerminal();
}
