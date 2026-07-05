import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import type { FileClipboard, FileEndpoint } from "@/stores/fileClipboardStore";
import type { PendingTransferAction } from "@/stores/transferQueueStore";
import { type TransferTarget, transferItem } from "@/services/sftpTransferCore";
import { classifyPaste } from "./pasteClassify";
import { copyNameCandidate } from "./copyNameCandidate";
import { sameHost } from "@/stores/fileClipboardStore";
import { runIntraPaneMove } from "./moveService";
import {
  fsExists, sftpExists, fsRename, sftpRename, fsDelete, sftpDelete,
} from "@/services/sftp";

export interface PasteDeps {
  existsInDest: (name: string) => Promise<boolean>;
  copyTarget: (t: TransferTarget) => Promise<void>;
  moveSameHost: (items: FileEntry[], destDir: string) => Promise<void>;
  deleteSource: (path: string) => Promise<void>;
  setPending: (p: PendingTransferAction | null) => void;
  refresh: () => void;
  clearClipboard: () => void;
}

const joinDir = (dir: string, name: string) =>
  `${dir === "/" ? "" : dir.replace(/\/$/, "")}/${name}`;

// Pick the first non-colliding Explorer name. startN=1 forces a "- Copy" for
// same-folder pastes; 0 keeps the original name when the folder differs.
async function uniqueTarget(item: FileEntry, destCwd: string, startN: number, existsInDest: PasteDeps["existsInDest"]): Promise<TransferTarget> {
  let n = startN;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const name = copyNameCandidate(item.name, item.isDir, n);
    if (!(await existsInDest(name))) {
      return { srcPath: item.path, dstPath: joinDir(destCwd, name), isDir: item.isDir, name };
    }
    n++;
  }
}

export async function executePaste(clip: NonNullable<FileClipboard>, dest: FileEndpoint, deps: PasteDeps): Promise<void> {
  const kind = classifyPaste(clip, dest);
  if (kind === "noop" || kind === "reject") return;

  if (kind === "move-same") {
    await deps.moveSameHost(clip.items, dest.cwd);
    return;
  }

  if (kind === "copy") {
    const startN = sameHost(clip.source, dest) && clip.source.cwd === dest.cwd ? 1 : 0;
    for (const item of clip.items) {
      const target = await uniqueTarget(item, dest.cwd, startN, deps.existsInDest);
      try { await deps.copyTarget(target); } catch { /* copy failed; source intact, continue */ }
    }
    deps.refresh();
    return; // copy persists the clipboard
  }

  // move-cross: copy then delete source; defer collisions to the conflict dialog.
  const conflicts: FileEntry[] = [];
  for (const item of clip.items) if (await deps.existsInDest(item.name)) conflicts.push(item);
  const conflictPaths = new Set(conflicts.map((f) => f.path));

  const run = async (chosen: FileEntry[]) => {
    for (const item of chosen) {
      const target: TransferTarget = { srcPath: item.path, dstPath: joinDir(dest.cwd, item.name), isDir: item.isDir, name: item.name };
      try {
        await deps.copyTarget(target);
      } catch {
        continue; // copy failed → keep the source, skip delete
      }
      await deps.deleteSource(item.path);
    }
    deps.refresh();
    deps.clearClipboard();
  };

  if (conflicts.length > 0) {
    deps.setPending({
      conflicts,
      toTransfer: clip.items.filter((f) => !conflictPaths.has(f.path)),
      totalConflicts: conflicts.length,
      execute: (chosen) => void run(chosen),
    });
    return;
  }
  await run(clip.items);
}

type RunTransfer = (label: string, dir: "→" | "←", fn: (tid: string) => Promise<void>, onDone?: () => void, accelerated?: boolean) => Promise<void>;

export function buildPasteDeps(
  clip: NonNullable<FileClipboard>,
  dest: FileEndpoint,
  wiring: { runTransfer: RunTransfer; setPending: PasteDeps["setPending"]; refresh: () => void; clearClipboard: () => void },
): PasteDeps {
  const src = clip.source;
  const from = src.isLocal ? "local" : "remote";
  const to = dest.isLocal ? "local" : "remote";
  const existsAt = (ep: FileEndpoint, path: string) => (ep.isLocal ? fsExists(path) : sftpExists(ep.sftpId!, path));

  return {
    existsInDest: (name) => existsAt(dest, joinDir(dest.cwd, name)),
    copyTarget: async (target) => {
      let ok = false;
      await wiring.runTransfer(
        target.name, "→",
        (tid) => transferItem({
          from, to,
          srcSftpId: src.sftpId ?? undefined,
          dstSftpId: dest.sftpId ?? undefined,
          srcPath: target.srcPath, dstPath: target.dstPath,
          isDir: target.isDir, useTar: false, transferId: tid,
        }),
        () => { ok = true; },
      );
      if (!ok) throw new Error(`paste: copy failed for ${target.name}`);
    },
    moveSameHost: (items, destDir) =>
      runIntraPaneMove(items, destDir, {
        exists: (p) => existsAt(dest, p),
        del: (p) => (dest.isLocal ? fsDelete(p) : sftpDelete(dest.sftpId!, p)),
        rename: (a, b) => (dest.isLocal ? fsRename(a, b) : sftpRename(dest.sftpId!, a, b)),
        setPending: wiring.setPending,
        onRefresh: () => { wiring.refresh(); wiring.clearClipboard(); },
      }),
    deleteSource: (p) => (src.isLocal ? fsDelete(p) : sftpDelete(src.sftpId!, p)),
    setPending: wiring.setPending,
    refresh: wiring.refresh,
    clearClipboard: wiring.clearClipboard,
  };
}
