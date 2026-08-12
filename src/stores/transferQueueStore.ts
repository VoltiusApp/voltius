import { create } from "zustand";
import { sftpCancelTransfer, onTransferProgress } from "@/services/sftp";
import { type Transfer, type FileEntry, type ConflictResolution, genId } from "@/components/filetransfer/SFTPTypes";
import type { McpOwner } from "@/stores/mcpOwnershipStore";

// A pending transfer is queued whenever the destination already contains files
// that would be overwritten. The `execute` callback is invoked once the user
// resolves all conflicts; it receives the final set of files to transfer
// (input toTransfer + any conflicts they chose to overwrite).
export type PendingTransferAction = {
  conflicts: FileEntry[];
  toTransfer: FileEntry[];
  totalConflicts: number;
  execute: (files: FileEntry[]) => void;
};

interface TransferQueueStore {
  transfers: Transfer[];
  pending: PendingTransferAction | null;
  setPending: (p: PendingTransferAction | null) => void;
  resolvePending: (resolution: ConflictResolution) => void;
  runTransfer: (
    label: string,
    direction: "→" | "←",
    fn: (transferId: string) => Promise<void>,
    onDone?: () => void,
    accelerated?: boolean,
    owner?: McpOwner,
  ) => Promise<void>;
  cancelTransfer: (id: string) => void;
  cancelAll: () => void;
  clearCompleted: () => void;
  /** True for a transfer that ended in `cancelled` or `error` and kept its descriptor. */
  canRetry: (id: string) => boolean;
  /** Re-runs a failed transfer under a NEW id; the original row stays as history. */
  retryTransfer: (id: string) => void;
}

const MAX_TRANSFERS = 30;

export const useTransferQueueStore = create<TransferQueueStore>((set, get) => ({
  transfers: [],
  pending: null,

  setPending: (p) => set({ pending: p }),

  resolvePending: (resolution) => {
    const pending = get().pending;
    if (!pending) return;
    const { conflicts, toTransfer, totalConflicts, execute } = pending;
    const [current, ...remaining] = conflicts;
    const finish = (files: FileEntry[]) => { set({ pending: null }); execute(files); };

    if (resolution === "cancel") { set({ pending: null }); return; }
    if (resolution === "skip") {
      if (remaining.length > 0) set({ pending: { conflicts: remaining, toTransfer, totalConflicts, execute } });
      else finish(toTransfer);
      return;
    }
    if (resolution === "skip-all") { finish(toTransfer); return; }
    if (resolution === "overwrite") {
      const next = [...toTransfer, current];
      if (remaining.length > 0) set({ pending: { conflicts: remaining, toTransfer: next, totalConflicts, execute } });
      else finish(next);
      return;
    }
    if (resolution === "overwrite-all") { finish([...toTransfer, current, ...remaining]); return; }
  },

  runTransfer: async (label, direction, fn, onDone, accelerated = false, owner) => {
    const tid = genId();
    const entry: Transfer = {
      id: tid, label, direction, transferred: 0, total: 0, status: "running",
      accelerated, owner, rerun: { fn, onDone },
    };
    set((s) => ({ transfers: [entry, ...s.transfers.slice(0, MAX_TRANSFERS - 1)] }));
    const startTime = Date.now();
    const unlisten = await onTransferProgress(tid, (p) => {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0.5 ? p.transferred / elapsed : undefined;
      const eta = speed && p.total > p.transferred ? Math.round((p.total - p.transferred) / speed) : undefined;
      set((s) => ({
        transfers: s.transfers.map((t) =>
          t.id === tid ? { ...t, transferred: p.transferred, total: p.total, speed, eta } : t,
        ),
      }));
    });
    try {
      await fn(tid);
      set((s) => ({
        transfers: s.transfers.map((t) => (t.id === tid ? { ...t, status: "done" } : t)),
      }));
      onDone?.();
    } catch (e) {
      const msg = String(e);
      const wasCancelled = msg.toLowerCase().includes("cancel");
      set((s) => ({
        transfers: s.transfers.map((t) => {
          if (t.id !== tid) return t;
          if (t.status === "cancelled") return t;
          return wasCancelled ? { ...t, status: "cancelled" } : { ...t, status: "error", error: msg };
        }),
      }));
    } finally {
      unlisten();
    }
  },

  cancelTransfer: (id) => {
    sftpCancelTransfer(id).catch(() => {});
    set((s) => ({
      transfers: s.transfers.map((t) => (t.id === id ? { ...t, status: "cancelled" } : t)),
    }));
  },

  cancelAll: () => {
    const running = get().transfers.filter((t) => t.status === "running");
    for (const t of running) sftpCancelTransfer(t.id).catch(() => {});
    set((s) => ({
      transfers: s.transfers.map((t) => (t.status === "running" ? { ...t, status: "cancelled" } : t)),
    }));
  },

  clearCompleted: () =>
    set((s) => ({ transfers: s.transfers.filter((t) => t.status === "running") })),

  canRetry: (id) => {
    const tr = get().transfers.find((t) => t.id === id);
    return !!tr?.rerun && (tr.status === "error" || tr.status === "cancelled");
  },

  retryTransfer: (id) => {
    const tr = get().transfers.find((t) => t.id === id);
    if (!tr?.rerun || (tr.status !== "error" && tr.status !== "cancelled")) return;
    // runTransfer's cap logic evicts whatever is currently last. If the row being
    // retried sits there (a full queue, oldest-first at the tail), bump it forward
    // so the prepend-and-slice below drops a different row instead of this one.
    set((s) => {
      if (s.transfers.length < MAX_TRANSFERS || s.transfers[s.transfers.length - 1]?.id !== id) return s;
      const rest = s.transfers.filter((t) => t.id !== id);
      return { transfers: [rest[0], tr, ...rest.slice(1)] };
    });
    void get().runTransfer(tr.label, tr.direction, tr.rerun.fn, tr.rerun.onDone, tr.accelerated, tr.owner);
  },
}));
