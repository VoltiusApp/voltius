import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../state/agentStore";

export function ContextChip() {
  const { t } = useTranslation();
  const ctx = useAgentStore((s) => s.pendingContext);
  const clearContext = useAgentStore((s) => s.clearContext);
  if (!ctx) return null;

  const source = t(`aiAgent.touchpoint.chip.${ctx.source}`);
  return (
    <div className="self-start flex items-center gap-1.5 max-w-full rounded-full py-0.5 pl-2 pr-1 text-[11px] bg-(--t-bg-elevated) border border-(--t-border) text-(--t-text-secondary)">
      <Icon icon="lucide:paperclip" width={11} />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {ctx.connectionName} · {source} · {t("aiAgent.touchpoint.chip.lines", { count: ctx.lineCount })}
        {ctx.truncated ? ` · ${t("aiAgent.touchpoint.chip.truncated")}` : ""}
      </span>
      <button
        type="button"
        onClick={clearContext}
        title={t("aiAgent.touchpoint.chip.remove")}
        aria-label={t("aiAgent.touchpoint.chip.remove")}
        className="bg-transparent text-(--t-text-secondary) shrink-0"
      >
        <Icon icon="lucide:x" width={11} />
      </button>
    </div>
  );
}
