import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { TransferQueue } from "./TransferQueue";

/**
 * Renders the floating transfer queue widget for the full SFTPPage. The SFTP
 * right panel docks its own copy inside the panel card, so this widget is
 * scoped to the SFTPPage only and stays out of the rest of the app.
 */
export function GlobalTransferQueue() {
  const transfers = useTransferQueueStore((s) => s.transfers);
  const clearCompleted = useTransferQueueStore((s) => s.clearCompleted);
  const cancelTransfer = useTransferQueueStore((s) => s.cancelTransfer);
  const cancelAll = useTransferQueueStore((s) => s.cancelAll);
  // Only surface the floating widget on the full SFTPPage. Anywhere else the
  // queue is either irrelevant (terminal, vault) or already docked inside the
  // SFTP right panel, so the global one would just be noise / a duplicate.
  const sftpPageOpen = useUIStore((s) => s.sftpPanelOpen);
  const sftpPanelMounted = useUIStore((s) => s.rightPanelOpen && s.rightPanelSection === "sftp" && s.activeNav !== "hosts");
  const hasActiveSession = useSessionStore((s) => s.activeSessionId !== null && s.sessions.length > 0);
  if (transfers.length === 0 || !sftpPageOpen || (sftpPanelMounted && hasActiveSession)) return null;
  // Offset by the SFTPPage's p-3 gutter so the widget's right edge lines up with
  // the right (destination) pane rather than the viewport edge, and round the
  // top corners so it reads as a detached card docked to the bottom.
  return (
    <div className="fixed bottom-0 right-3 z-40 w-88 max-w-[90vw] rounded-t-xl overflow-hidden shadow-2xl">
      <TransferQueue transfers={transfers} onClear={clearCompleted} onCancel={cancelTransfer} onCancelAll={cancelAll} collapsible />
    </div>
  );
}
