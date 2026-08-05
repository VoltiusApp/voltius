import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import type { PendingCascade } from "./useVaultCascade";

/**
 * Promise-based cross-vault paste confirmation. useVaultCascade's `execute` is
 * fire-and-forget and its `cancel` answers nothing, but the paste awaits the
 * user inside its serialized queue, so the answer has to come back as a promise.
 */
export function useCrossVaultPasteConfirm() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingCascade | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(ok);
  }, []);

  const confirmCrossVault = useCallback(
    (summary: { count: number; targetVaultName: string }) =>
      new Promise<boolean>((resolve) => {
        // Pastes are serialized so two prompts cannot overlap; if one somehow
        // does, the older resolver is answered rather than stranded.
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        const isMove = useVaultClipboardStore.getState().clipboard?.mode === "cut";
        setPending({
          operation: isMove ? "move" : "copy",
          targetVaultName: summary.targetVaultName,
          heading: t(
            isMove
              ? "common.clipboard.crossVaultMoveHeading"
              : "common.clipboard.crossVaultCopyHeading",
          ),
          description: t(
            isMove
              ? "common.clipboard.crossVaultMoveDescription"
              : "common.clipboard.crossVaultCopyDescription",
            { count: summary.count, targetVaultName: summary.targetVaultName },
          ),
          items: [],
          execute: async () => {},
        });
      }),
    [t],
  );

  const accept = useCallback(() => settle(true), [settle]);
  const cancel = useCallback(() => settle(false), [settle]);

  return { pending, confirmCrossVault, accept, cancel };
}
