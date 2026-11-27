import { create } from "zustand";
import { transferLimit, useSftpSettingsStore } from "./sftpSettingsStore";
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

// Share slots across panes, retries and both directions. Equal filenames are
// kept in submission order so a multi-selection cannot race its own overwrite.
const activeNames = new Set<string>();
const queued = new Map<string, { name: string; admit: (run: boolean) => void }>();

function startQueued() {
  const limit = transferLimit(useSftpSettingsStore.getState().parallelTransfers);
  for (const [id, job] of queued) {
    if (activeNames.size >= limit) break;
    if (activeNames.has(job.name)) continue;
    queued.delete(id);
    activeNames.add(job.name);
    job.admit(true);
  }
}

useSftpSettingsStore.subscribe((s, prev) => {
  if (s.parallelTransfers !== prev.parallelTransfers) startQueued();
});

// The history cap can evict finished rows only. Even large selections must
// keep their queued and in-flight rows visible and cancellable.
function trimHistory(rows: Transfer[]) {
  if (rows.length <= MAX_TRANSFERS) return rows;
  let keep = MAX_TRANSFERS - rows.filter((row) => !row.settled).length;
  return rows.filter((row) => !row.settled || keep-- > 0);
}

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
      queued: true, accel, owner, rerun: { fn, onDone },
    };
    const update = (f: (t: Transfer) => Transfer) =>
      set((s) => ({ transfers: s.transfers.map((t) => (t.id === tid ? f(t) : t)) }));
    const name = label.normalize().toLowerCase();
    const admitted = await new Promise<boolean>((admit) => {
      queued.set(tid, { name, admit });
      set((s) => ({ transfers: trimHistory([entry, ...s.transfers]) }));
      startQueued();
    });
    if (!admitted) return;
    update((t) => ({ ...t, queued: false }));
    // Speed counts from the first progress after the start, a resume, or a wait.
    let base: { at: number; bytes: number } | null = null;
    const unlisten: (() => void)[] = [];
    try {
      const subscriptions = await Promise.allSettled([
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
      for (const sub of subscriptions) if (sub.status === "fulfilled") unlisten.push(sub.value);
      const failure = subscriptions.find((sub) => sub.status === "rejected");
      if (failure) throw failure.reason;
      if (opts?.resume) await sftpMarkResume(tid).catch(() => {});
      await fn(tid);
      if (get().transfers.find((t) => t.id === tid)?.status === "running") {
        update((t) => ({ ...t, status: "done" }));
        onDone?.();
      }
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
      activeNames.delete(name);
      set((s) => ({ transfers: trimHistory(s.transfers.map((t) => t.id === tid ? { ...t, settled: true } : t)) }));
      startQueued();
      for (const off of unlisten) off();
    }
  },

  cancelTransfer: (id) => {
    const tr = get().transfers.find((t) => t.id === id);
    if (!tr || tr.status !== "running") return false;
    const job = queued.get(id);
    if (job) {
      queued.delete(id);
      job.admit(false);
    } else {
      sftpCancelTransfer(id).catch(() => {});
    }
    set((s) => ({
      transfers: trimHistory(s.transfers.map((t) => t.id === id
        ? { ...t, status: "cancelled", queued: false, settled: job ? true : t.settled }
        : t)),
    }));
    return true;
  },

  cancelAll: () => {
    for (const t of get().transfers) if (t.status === "running") get().cancelTransfer(t.id);
  },

  clearCompleted: () =>
    set((s) => ({ transfers: s.transfers.filter((t) => t.status === "running") })),

  canRetry: (id) => canRetryTransfer(get().transfers.find((t) => t.id === id)),

  retryTransfer: (id) => {
    if (!get().canRetry(id)) return;
    const tr = get().transfers.find((t) => t.id === id)!;
    // Keep the retried row alongside its new attempt when history is full.
    set((s) => {
      if (s.transfers.length < MAX_TRANSFERS || s.transfers[s.transfers.length - 1]?.id !== id) return s;
      const rest = s.transfers.filter((t) => t.id !== id);
      return { transfers: [rest[0], tr, ...rest.slice(1)] };
    });
    void get().runTransfer(tr.label, tr.direction, tr.rerun!.fn, tr.rerun!.onDone, tr.accel, tr.owner, { resume: true });
  },
}));
