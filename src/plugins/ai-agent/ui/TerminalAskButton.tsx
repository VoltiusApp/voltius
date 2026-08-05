import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getAgentDeps, useAgentStore } from "../state/agentStore";
import { buildTerminalContext } from "../state/touchpoint";
import { openPanel } from "../panel";

export function TerminalAskButton({ sessionId, connectionName }: { sessionId: string; connectionName: string }) {
  const { t } = useTranslation();
  const attachContext = useAgentStore((s) => s.attachContext);

  const onClick = () => {
    const api = getAgentDeps()?.api;
    if (api) {
      const ctx = buildTerminalContext(api, sessionId, connectionName);
      if (ctx) attachContext(ctx);
    }
    openPanel();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={t("aiAgent.touchpoint.button")}
      aria-label={t("aiAgent.touchpoint.button")}
      className="flex items-center px-1.5 h-full rounded-none transition-colors hover:bg-(--t-bg-card-hover)"
      style={{ color: "var(--t-text-dim)" }}
    >
      <Icon icon="lucide:sparkles" width={13} />
    </button>
  );
}
