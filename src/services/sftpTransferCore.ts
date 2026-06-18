import type { FileEntry } from "@/components/filetransfer/SFTPTypes";

export interface TransferTarget { srcPath: string; dstPath: string; isDir: boolean; name: string; }

/** Map selected entries to copy targets under destDir (POSIX join, no doubled slash). */
export function buildTransferTargets(selected: FileEntry[], destDir: string): TransferTarget[] {
  const base = destDir === "/" ? "" : destDir.replace(/\/$/, "");
  return selected.map((f) => ({ srcPath: f.path, dstPath: `${base}/${f.name}`, isDir: f.isDir, name: f.name }));
}
