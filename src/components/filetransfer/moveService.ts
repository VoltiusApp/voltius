import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import type { PendingTransferAction } from "@/stores/transferQueueStore";
import { buildMoveTargets } from "./moveTargetCore";
import { describeError } from "@/services/backendErrors";
import i18n from "@/i18n";

// Injected I/O so the same flow serves remote (sftp*) and local (fs*) panes and
// stays unit-testable with fakes.
export interface MoveOps {
  exists: (path: string) => Promise<boolean>;
  del: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  setPending: (p: PendingTransferAction | null) => void;
  onRefresh: () => void;
  onError?: (message: string) => void;
}

// Move the selected items into targetDir via rename. When the destination
// already holds same-named items, defer to the shared ConflictDialog/pending
// flow; the user's chosen subset is then renamed (delete-then-rename so an
// overwrite replaces the existing item).
export async function runIntraPaneMove(files: FileEntry[], targetDir: string, ops: MoveOps): Promise<void> {
  const targets = buildMoveTargets(files, targetDir);

  const run = async (chosen: FileEntry[]) => {
    const targetByPath = new Map(targets.map((t) => [t.from, t]));
    for (const file of chosen) {
      const target = targetByPath.get(file.path);
      if (!target) continue;
      if (target.from === target.to) continue; // never delete-then-rename onto self
      try {
        if (await ops.exists(target.to)) await ops.del(target.to);
        await ops.rename(target.from, target.to);
      } catch (e) { ops.onError?.(describeError(e, i18n.t)); }
    }
    ops.onRefresh();
  };

  const conflicts = (
    await Promise.all(targets.map(async (target) =>
      (await ops.exists(target.to)) ? files.find((file) => file.path === target.from)! : null))
  ).filter((file): file is FileEntry => file !== null);

  if (conflicts.length > 0) {
    const conflictPaths = new Set(conflicts.map((file) => file.path));
    ops.setPending({
      conflicts,
      toTransfer: files.filter((file) => !conflictPaths.has(file.path)),
      totalConflicts: conflicts.length,
      execute: (chosen) => void run(chosen),
    });
    return;
  }
  await run(files);
}
