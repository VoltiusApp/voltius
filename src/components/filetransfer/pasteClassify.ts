import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import { sameHost, type FileEndpoint } from "@/stores/fileClipboardStore";
import { isSameOrUnder } from "./moveTargetCore";

export type PasteKind = "copy" | "move-same" | "move-cross" | "noop" | "reject";

export function classifyPaste(
  clip: { mode: "copy" | "cut"; items: FileEntry[]; source: FileEndpoint },
  dest: FileEndpoint,
): PasteKind {
  const same = sameHost(clip.source, dest);
  if (same && clip.items.some((i) => i.isDir && isSameOrUnder(dest.cwd, i.path))) return "reject";
  if (clip.mode === "cut" && same && clip.source.cwd === dest.cwd) return "noop";
  if (clip.mode === "copy") return "copy";
  return same ? "move-same" : "move-cross";
}
