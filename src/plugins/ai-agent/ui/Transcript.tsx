import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../state/agentStore";
import { ApprovalCard } from "./ApprovalCard";
import { PlanCard } from "./PlanCard";
import { RichText } from "./RichText";
import { useObjectRefs } from "./useObjectRefs";

const EXPAND_THRESHOLD = 120;

export function Transcript() {
  const { t } = useTranslation();
  const transcript = useAgentStore((s) => s.transcript);
  const pendingApprovals = useAgentStore((s) => s.pendingApprovals);
  const errorText = useAgentStore((s) => s.errorText);
  const refs = useObjectRefs();

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      {transcript.map((entry, i) => {
        if (entry.kind === "plan") return <PlanCard key={entry.planId} entry={entry} />;

        if (entry.kind === "tool") {
          const long = entry.detail.length > EXPAND_THRESHOLD || entry.detail.includes("\n");
          const head = (
            <>
              <Icon icon="lucide:terminal" width={12} />
              <span>{entry.tool}</span>
              <span className="opacity-70">{entry.state}</span>
            </>
          );
          if (!long) {
            return (
              <div key={i} className="self-start flex items-center gap-1.5 text-[11px] text-(--t-text-secondary) bg-(--t-bg-elevated) border border-(--t-border) rounded-md px-2 py-1">
                {head}
                <span className="opacity-60"><RichText text={entry.detail} refs={refs} /></span>
              </div>
            );
          }
          return (
            <details key={i} className="self-start max-w-full text-[11px] text-(--t-text-secondary) bg-(--t-bg-elevated) border border-(--t-border) rounded-md px-2 py-1">
              <summary className="flex items-center gap-1.5 cursor-pointer list-none">
                {head}
                <span className="opacity-60 truncate max-w-[16rem]">{entry.detail.split("\n")[0]}</span>
              </summary>
              <div className="mt-1 font-mono overflow-x-auto max-h-64">
                <RichText text={entry.detail} refs={refs} />
              </div>
            </details>
          );
        }

        const isUser = entry.kind === "user";
        return (
          <div
            key={i}
            className={[
              "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13px] whitespace-pre-wrap break-words",
              isUser
                ? "self-end bg-(--t-accent) text-[color:var(--t-on-accent,#fff)]"
                : "self-start bg-(--t-bg-elevated) text-(--t-text-bright)",
            ].join(" ")}
          >
            {isUser ? entry.text : <RichText text={entry.text} refs={refs} />}
            {entry.kind === "user" && entry.attachment && (
              <div className="mt-1 text-[11px] opacity-75">
                {t("aiAgent.touchpoint.attached", { count: entry.attachment.lineCount })}
              </div>
            )}
          </div>
        );
      })}

      {pendingApprovals.map((p) => <ApprovalCard key={p.id} pending={p} />)}

      {errorText && <div className="text-(--t-status-error) text-xs py-1">{errorText}</div>}
    </div>
  );
}
