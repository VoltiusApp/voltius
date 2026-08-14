import { SnippetVariableModal } from "@/components/terminal/SnippetVariableModal";
import { reportSequenceResult } from "@/services/snippetSequence";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSnippetStore } from "@/stores/snippetStore";
import i18n from "@/i18n";

/** Head of the app-global snippet-variable prompt queue. The `key` is what makes
 *  each queued prompt a fresh modal instance: without it React reuses the
 *  instance and prompt N+1 inherits prompt N's typed values. */
export function PendingSequenceModal() {
  const pending = useSnippetStore((s) => s.pendingSequences[0] ?? null);
  const shift = useSnippetStore((s) => s.shiftPendingSequence);

  if (!pending) return null;

  return (
    <SnippetVariableModal
      key={pending.queueId}
      snippetName={pending.snippet.name}
      contextLabel={pending.contextLabel}
      partialTemplate={pending.partialTemplate}
      userVars={pending.userVars}
      initialValues={pending.initialValues}
      onInject={() => {}}
      onSubmitValues={(values) => {
        const resume = pending.resume;
        shift();
        resume(values).then(reportSequenceResult).catch((e: unknown) => {
          useNotificationStore.getState().addToast({
            source: { kind: "plugin", id: "snippets", name: "Snippets" }, type: "toast",
            message: i18n.t("snippets.sequence.resumeFailed", {
              error: e instanceof Error ? e.message : String(e),
            }),
            severity: "error", duration: 8000,
          });
        });
      }}
      onClose={() => {
        const dismissed = pending.onDismissed;
        shift();
        dismissed?.();
      }}
    />
  );
}
