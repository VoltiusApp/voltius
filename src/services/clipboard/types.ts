import type { ClipboardAdapter } from "@/services/vaultClipboard";

/** The half of the adapter vaultClipboardBase does not build. */
export type ClipboardHalf = Pick<
  ClipboardAdapter,
  "folderContentKinds" | "danglingKinds" | "moveItems" | "duplicateItems" | "deleteItems"
> &
  Partial<Pick<ClipboardAdapter, "planCascade" | "applyCascade">>;
