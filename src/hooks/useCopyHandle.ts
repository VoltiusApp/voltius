import { useCopyText } from "@/hooks/useCopyText";

/** One-tap "copy my address": writes `@handle`, shared by Settings → Account and the account menu. */
export function useCopyHandle(handle: string | null): { copied: boolean; copy: () => void } {
  const { copied, copy } = useCopyText();
  return { copied, copy: () => { if (handle) copy(`@${handle}`); } };
}
