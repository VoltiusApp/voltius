import { useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { useT } from "../useT";
import { useAgentStore } from "../state/agentStore";
import { ApprovalCard } from "./ApprovalCard";
import { PlanCard } from "./PlanCard";
import { RichText } from "./RichText";
import { useObjectRefs } from "./useObjectRefs";
import { summarizeTool } from "../state/toolSummary";

const EXPAND_THRESHOLD = 120;
/** Distance from the bottom still treated as "following the stream". */
const STICK_SLACK_PX = 48;

export function Transcript() {
  const { t, tCount } = useT();
  const transcript = useAgentStore((s) => s.transcript);
  const pendingApprovals = useAgentStore((s) => s.pendingApprovals);
  const errorText = useAgentStore((s) => s.errorText);
  const clearError = useAgentStore((s) => s.clearError);
  const refs = useObjectRefs();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only follow the stream while the user is already at the bottom: scrolling
  // up to read an earlier result must not be yanked back by the next delta.
  const stick = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, pendingApprovals, errorText]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK_PX;
  };

  const empty = transcript.length === 0 && pendingApprovals.length === 0;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      {empty && (
        <div className="m-auto flex flex-col items-center gap-1.5 px-4 text-center">
          <Icon icon="lucide:sparkles" width={20} className="text-(--t-text-dim)" />
          <span className="text-[13px] text-(--t-text-secondary)">{t("aiAgent.transcript.empty.title")}</span>
          <span className="text-[11px] text-(--t-text-dim)">{t("aiAgent.transcript.empty.hint")}</span>
        </div>
      )}
      {transcript.map((entry, i) => {
        if (entry.kind === "plan") return <PlanCard key={entry.planId} entry={entry} />;

        if (entry.kind === "tool") {
          const failed = entry.state === "error";
          const summary = summarizeTool(entry.state, entry.detail, (n) =>
            tCount("aiAgent.transcript.items", n));
          // Expandable whenever the row is not already showing everything —
          // the summary is a convenience, never the only record of what ran.
          const headText = (summary.split("\n").find((l) => l.trim()) ?? "").trim();
          const expandable =
            headText !== entry.detail ||
            entry.detail.length > EXPAND_THRESHOLD ||
            entry.detail.includes("\n");
          const shell = failed
            ? "text-(--t-status-error) bg-[color:color-mix(in_srgb,var(--t-status-error)_8%,transparent)] border-[color:color-mix(in_srgb,var(--t-status-error)_40%,transparent)]"
            : "text-(--t-text-secondary) bg-(--t-bg-elevated) border-(--t-border)";
          const head = (
            <>
              <Icon
                icon={failed ? "lucide:circle-x" : entry.state === "call" ? "lucide:play" : "lucide:check"}
                width={12}
                className="shrink-0"
              />
              <span className="shrink-0 font-medium">{entry.tool}</span>
              {headText && (
                // One line only: a multi-line summary (a zod validation dump,
                // say) rendered whitespace-pre-wrap defeats `truncate` and
                // grows the row to fill the drawer.
                <span className="opacity-70 truncate min-w-0">
                  <RichText text={headText} refs={refs} oneLine />
                </span>
              )}
            </>
          );
          if (!expandable) {
            return (
              <div key={i} className={`self-start max-w-full flex items-center gap-1.5 text-[11px] border rounded-md px-2 py-1 ${shell}`}>
                {head}
              </div>
            );
          }
          return (
            <details key={i} className={`self-start max-w-full text-[11px] border rounded-md px-2 py-1 ${shell}`}>
              <summary className="flex items-center gap-1.5 cursor-pointer list-none">{head}</summary>
              <div className="mt-1 font-mono overflow-x-auto max-h-64 whitespace-pre-wrap break-all opacity-80">
                {entry.detail}
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
                {tCount("aiAgent.touchpoint.attached", entry.attachment.lineCount)}
              </div>
            )}
          </div>
        );
      })}

      {pendingApprovals.map((p) => <ApprovalCard key={p.id} pending={p} />)}

      {errorText && (
        <div className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs text-(--t-status-error) bg-[color:color-mix(in_srgb,var(--t-status-error)_8%,transparent)] border border-[color:color-mix(in_srgb,var(--t-status-error)_40%,transparent)]">
          <Icon icon="lucide:triangle-alert" width={13} className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{errorText}</span>
          <button
            type="button"
            onClick={clearError}
            title={t("aiAgent.error.dismiss")}
            aria-label={t("aiAgent.error.dismiss")}
            className="ml-auto shrink-0 bg-transparent text-(--t-status-error)"
          >
            <Icon icon="lucide:x" width={12} />
          </button>
        </div>
      )}
    </div>
  );
}
