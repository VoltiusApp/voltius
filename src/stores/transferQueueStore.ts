import { create } from "zustand";
import i18n from "@/i18n";
import { describeError } from "@/services/backendErrors";
import {
  sftpCancelTransfer, sftpMarkResume,
  onTransferProgress, onTransferSkipped, onTransferResumed, onTransferWaiting, onTransferAccel,
} from "@/services/sftp";
import { type Transfer, type FileEntry, type ConflictResolution, genId } from "@/components/filetransfer/SFTPTypes";
import type { Accel } from "@/components/filetransfer/tarSupport";
import type { McpOwner } from "@/stores/mcpOwnershipStore";

/** True for a settled transfer that ended in `cancelled` or `error` and kept
 *  its descriptor. Exported so the queue UI can gate the retry button on the
 *  same rule the store enforces, rather than a looser copy of it. */
export function canRetryTransfer(tr: Pick<Transfer, "rerun" | "settled" | "status"> | undefined): boolean {
  return !!tr?.rerun && !!tr.settled && (tr.status === "error" || tr.status === "cancelled");
}

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
    accel?: Accel,
    owner?: McpOwner,
    opts?: { resume?: boolean },
  ) => Promise<void>;
  /** False when the id is unknown or the row is not currently running. */
  cancelTransfer: (id: string) => boolean;
  cancelAll: () => void;
  clearCompleted: () => void;
  /** True for a settled transfer that ended in `cancelled` or `error` and kept its descriptor. */
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

  runTransfer: async (label, direction, fn, onDone, accel, owner, opts) => {
    const tid = genId();
    const entry: Transfer = {
      id: tid, label, direction, transferred: 0, total: 0, status: "running",
      accel, owner, rerun: { fn, onDone },
    };
    set((s) => ({ transfers: [entry, ...s.transfers.slice(0, MAX_TRANSFERS - 1)] }));
    const update = (f: (t: Transfer) => Transfer) =>
      set((s) => ({ transfers: s.transfers.map((t) => (t.id === tid ? f(t) : t)) }));
    // Speed counts from the first progress after the start, a resume, or a wait.
    let base: { at: number; bytes: number } | null = null;
    const unlisten = await Promise.all([
      onTransferProgress(tid, (p) => {
        base ??= { at: Date.now(), bytes: p.transferred };
        const elapsed = (Date.now() - base.at) / 1000;
        const speed = elapsed > 0.5 ? (p.transferred - base.bytes) / elapsed : undefined;
        const eta = speed && p.total > p.transferred ? Math.round((p.total - p.transferred) / speed) : undefined;
        update((t) => ({ ...t, transferred: p.transferred, total: p.total, speed, eta }));
      }),
      onTransferSkipped(tid, (path) => update((t) => ({ ...t, skipped: [...(t.skipped ?? []), path] }))),
      onTransferResumed(tid, (offset) => {
        base = null;
        update((t) => ({ ...t, resumedAt: offset, transferred: offset }));
      }),
      onTransferWaiting(tid, (waiting) => {
        base = null;
        update((t) => ({ ...t, waiting, speed: undefined, eta: undefined }));
      }),
      onTransferAccel(tid, (a) => update((t) => ({ ...t, accel: a }))),
    ]);
    try {
      if (opts?.resume) await sftpMarkResume(tid).catch(() => {});
      await fn(tid);
      update((t) => ({ ...t, status: "done" }));
      onDone?.();
    } catch (e) {
      const msg = String(e);
      const wasCancelled = msg.toLowerCase().includes("cancel");
      update((t) => {
        if (t.status === "cancelled") return t;
        return wasCancelled
          ? { ...t, status: "cancelled", waiting: false }
          : { ...t, status: "error", waiting: false, error: describeError(e, i18n.t) };
      });
    } finally {
      update((t) => ({ ...t, settled: true }));
      for (const off of unlisten) off();
    }
  },

  cancelTransfer: (id) => {
    const tr = get().transfers.find((t) => t.id === id);
    if (!tr || tr.status !== "running") return false;
    sftpCancelTransfer(id).catch(() => {});
    set((s) => ({
      transfers: s.transfers.map((t) => (t.id === id ? { ...t, status: "cancelled" } : t)),
    }));
    return true;
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

  canRetry: (id) => canRetryTransfer(get().transfers.find((t) => t.id === id)),

  retryTransfer: (id) => {
    if (!get().canRetry(id)) return;
    const tr = get().transfers.find((t) => t.id === id)!;
    // runTransfer's cap logic evicts whatever is currently last. If the row being
    // retried sits there (a full queue, oldest-first at the tail), bump it forward
    // so the prepend-and-slice below drops a different row instead of this one.
    set((s) => {
      if (s.transfers.length < MAX_TRANSFERS || s.transfers[s.transfers.length - 1]?.id !== id) return s;
      const rest = s.transfers.filter((t) => t.id !== id);
      return { transfers: [rest[0], tr, ...rest.slice(1)] };
    });
    void get().runTransfer(tr.label, tr.direction, tr.rerun!.fn, tr.rerun!.onDone, tr.accel, tr.owner, { resume: true });
  },
}));
