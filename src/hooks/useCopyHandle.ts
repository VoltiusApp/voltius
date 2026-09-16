import { writeClipboard } from "@/utils/clipboard";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";

/**
 * One-tap "copy my address": writes `@handle` and flips a transient copied flag.
 * Shared by the two surfaces B4 puts the handle on — Settings → Account and the
 * account menu — so both spell the address the same way.
 */
export function useCopyHandle(handle: string | null): { copied: boolean; copy: () => void } {
  const { copied, flash } = useCopiedFlash(1500);
  const copy = () => {
    if (!handle) return;
    writeClipboard(`@${handle}`)
      .then(() => flash())
      .catch(() => {});
  };
  return { copied, copy };
}
