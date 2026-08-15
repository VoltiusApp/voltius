import { useState } from "react";
import { writeClipboard } from "@/utils/clipboard";

/**
 * One-tap "copy my address": writes `@handle` and flips a transient copied flag.
 * Shared by the two surfaces B4 puts the handle on — Settings → Account and the
 * account menu — so both spell the address the same way.
 */
export function useCopyHandle(handle: string | null): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!handle) return;
    writeClipboard(`@${handle}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return { copied, copy };
}
