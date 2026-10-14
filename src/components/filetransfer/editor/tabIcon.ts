import type { EditorTab } from "@/stores/editorStore";

const CODE = new Set([
  "ts","tsx","js","jsx","mjs","cjs","go","rs","py","c","h","cpp","cc","cxx",
  "hpp","java","kt","kts","cs","rb","lua","pl","pm","swift","sh","bash","zsh",
  "ksh","ps1","psm1",
]);
const DATA = new Set(["json","toml","yaml","yml","ini","cfg","conf","properties","env","xml"]);
const DOC = new Set(["md","markdown","txt"]);

const IMAGE = new Set(["png","jpg","jpeg","gif","webp","bmp","ico","avif","svg"]);

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** A name-only guess, used to pick which read to try first; the bytes decide what the file is. */
export function looksLikeImage(path: string): boolean {
  return IMAGE.has(extensionOf(path));
}

export function tabIcon(tab: EditorTab): string {
  if (tab.kind === "diff") return "lucide:git-compare";
  if (tab.image) return "lucide:image";
  const ext = extensionOf(tab.path);
  if (CODE.has(ext)) return "lucide:file-code";
  if (DATA.has(ext)) return "lucide:file-cog";
  if (DOC.has(ext)) return "lucide:file-text";
  return "lucide:file";
}
