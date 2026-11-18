import { writeClipboard } from "@/utils/clipboard";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";

export function useCopyText(): { copied: boolean; copy: (text: string) => void } {
  const { copied, flash } = useCopiedFlash(1500);
  const copy = (text: string) => {
    writeClipboard(text)
      .then(() => flash())
      .catch(() => {});
  };
  return { copied, copy };
}
