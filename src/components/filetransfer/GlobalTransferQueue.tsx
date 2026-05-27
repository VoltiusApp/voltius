import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { TransferQueue } from "./TransferQueue";

/**
 * Renders the global transfer queue widget once at the app shell. Transfers
 * started from SFTPPage or the right-panel SFTP tab both publish to
 * `useTransferQueueStore`, so a single mount surface keeps the UI in sync
 * regardless of which page is visible.
 */
export function GlobalTransferQueue() {
  const transfers = useTransferQueueStore((s) => s.transfers);
  const clearCompleted = useTransferQueueStore((s) => s.clearCompleted);
  const cancelTransfer = useTransferQueueStore((s) => s.cancelTransfer);
  if (transfers.length === 0) return null;
  return (
    <div className="fixed bottom-0 right-0 z-40 w-[22rem] max-w-[90vw] shadow-2xl">
      <TransferQueue transfers={transfers} onClear={clearCompleted} onCancel={cancelTransfer} />
    </div>
  );
}
