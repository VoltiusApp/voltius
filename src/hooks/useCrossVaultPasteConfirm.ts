import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import type { PendingCascade } from "./useVaultCascade";
import type { CascadeEntry } from "@/services/vaultClipboard";

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
    (summary: {
      count: number;
      targetVaultName: string;
      mode?: "copy" | "cut";
      cascade?: CascadeEntry[];
    }) =>
      new Promise<boolean>((resolve) => {
        // Pastes are serialized so two prompts cannot overlap; if one somehow
        // does, the older resolver is answered rather than stranded.
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        const isMove =
          (summary.mode ?? useVaultClipboardStore.getState().clipboard?.mode) === "cut";
        const cascade = summary.cascade ?? [];
        const named = (action: "move" | "copy") =>
          cascade.filter((c) => c.action === action).map((c) => c.label);
        // Said in the description as well as listed above it: the list shows WHAT
        // travels, this says what happens to it — and a copy where the user asked
        // for a move needs its reason given, not just its result.
        const moved = named("move");
        const copied = named("copy");
        const sentences = [
          t(
            isMove
              ? "common.clipboard.crossVaultMoveDescription"
              : "common.clipboard.crossVaultCopyDescription",
            { count: summary.count, targetVaultName: summary.targetVaultName },
          ),
          moved.length > 0
            ? t("common.clipboard.cascadeMoved", {
                count: moved.length,
                names: moved.join(", "),
              })
            : null,
          // A copy paste copies everything by definition, so naming a reason there
          // would answer a question the user never asked. The reason belongs to a
          // MOVE that quietly did something else.
          copied.length > 0
            ? t(
                isMove ? "common.clipboard.cascadeCopied" : "common.clipboard.cascadeAlsoCopied",
                { count: copied.length, names: copied.join(", ") },
              )
            : null,
        ].filter((s): s is string => !!s);

        setPending({
          operation: isMove ? "move" : "copy",
          targetVaultName: summary.targetVaultName,
          heading: t(
            isMove
              ? "common.clipboard.crossVaultMoveHeading"
              : "common.clipboard.crossVaultCopyHeading",
          ),
          description: sentences.join(" "),
          items: cascade.map((c) => ({ type: c.type, label: c.label })),
          execute: async () => {},
        });
      }),
    [t],
  );

  // Unmounting destroys the only UI that can answer the prompt, so an unanswered
  // one is declined here rather than left to stall the shared paste queue forever.
  useEffect(
    () => () => {
      const resolve = resolveRef.current;
      resolveRef.current = null;
      resolve?.(false);
    },
    [],
  );

  const accept = useCallback(() => settle(true), [settle]);
  const cancel = useCallback(() => settle(false), [settle]);

  return { pending, confirmCrossVault, accept, cancel };
}
