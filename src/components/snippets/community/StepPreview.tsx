import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { SnippetExport } from "@/services/import-export/formats";

/** Every step exactly as it will run. Nothing here truncates or collapses — a
 *  user who installs without reading is their own problem, a user who couldn't
 *  read is ours. */
export function StepPreview({ steps, nameOfEid }: {
  steps: SnippetExport["steps"];
  nameOfEid: (eid: string) => string;
}) {
  const { t } = useTranslation();
  if (!steps || steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((step, i) => {
        if (step.kind === "script") {
          return (
            <pre
              key={i}
              className="text-xs font-mono whitespace-pre-wrap break-words px-2.5 py-2 rounded-lg overflow-x-auto text-(--t-text-secondary)"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
            >
              {step.content}
            </pre>
          );
        }
        const label = step.kind === "transfer"
          ? `${step.from_path} → ${step.to_path}`
          : nameOfEid(step._eid);
        return (
          <div
            key={i}
            className="flex items-center gap-2 px-2.5 py-2 rounded-lg min-w-0"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
          >
            <Icon
              icon={step.kind === "transfer" ? "lucide:arrow-left-right" : "lucide:corner-down-right"}
              width={12}
              className="shrink-0 text-(--t-text-dim)"
            />
            <span className="text-xs text-(--t-text-dim) shrink-0">
              {t(step.kind === "transfer" ? "snippets.community.stepTransfer" : "snippets.community.stepSnippet")}
            </span>
            <span className="text-xs font-mono truncate text-(--t-text-secondary)">{label}</span>
            {step.kind === "transfer" && (
              <span className="text-xs text-(--t-text-dim) shrink-0 ml-auto">{step.mode} · {step.on_conflict}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
