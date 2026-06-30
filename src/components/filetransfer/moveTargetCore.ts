import type { FileEntry } from "@/components/filetransfer/SFTPTypes";

// Pure path helpers shared by the intra-pane drag-to-move flow. A path is
// treated as backslash-separated only when it contains no forward slash, which
// mirrors the sep logic used in FilePane's rename handler so local Windows /
// UNC paths and remote POSIX paths are handled consistently.

export function pathSep(path: string): "/" | "\\" {
  return path.includes("/") ? "/" : "\\";
}

export function parentDir(path: string): string {
  const sep = pathSep(path);
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = trimmed.lastIndexOf(sep);
  if (idx < 0) return "";
  if (idx === 0) return sep; // "/foo" -> "/"
  return trimmed.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  const sep = pathSep(dir);
  const base = dir === "/" ? "" : dir.replace(/[/\\]+$/, "");
  return `${base}${sep}${name}`;
}

// Normalize for comparison: unify separators and drop trailing slashes.
function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

export function isValidMoveTarget(files: FileEntry[], targetDir: string): boolean {
  if (files.length === 0) return false;
  const target = norm(targetDir);
  // A pane's selection always comes from one directory listing, so files[0]'s
  // parent represents the source directory of the whole selection.
  const srcParent = norm(parentDir(files[0].path));
  if (target === srcParent) return false; // already in this directory
  for (const file of files) {
    const fp = norm(file.path);
    if (target === fp) return false; // dropped onto itself
    if (file.isDir && target.startsWith(fp + "/")) return false; // into own descendant
  }
  return true;
}

export interface MoveTarget { from: string; to: string; name: string; isDir: boolean; }

export function buildMoveTargets(files: FileEntry[], targetDir: string): MoveTarget[] {
  return files.map((file) => ({
    from: file.path,
    to: joinPath(targetDir, file.name),
    name: file.name,
    isDir: file.isDir,
  }));
}
