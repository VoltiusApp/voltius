import { useCallback } from "react";
import { Icon, useT, useSessionById, MobileScreenHeader } from "@voltius/ui";
import type { FC } from "react";
import type { DockerTarget, PluginAPI, MobileScreenProps } from "@/plugins/api";
import { dockerStartLogStream } from "../services";
import { stripAnsi, useLogStream } from "../useLogStream";

export function createMobileDockerLogsScreen(api: PluginAPI): FC<MobileScreenProps> {
  return function MobileDockerLogsScreen(props) {
    const { sessionId, onBack } = props;
    const containerId = props.containerId as string;
    const containerName = props.containerName as string;

    const t = useT(api);
    const session = useSessionById(api, sessionId);
    const isRemote = session?.type === "ssh";
    const localShell = session?.type === "local" ? (session.localShell ?? null) : null;
    const ready = session?.type === "ssh" && session.status === "connected";

    const start = useCallback(() => {
      const target: DockerTarget = { sessionId, isRemote: !!isRemote, localShell };
      return dockerStartLogStream(target, containerId, 200);
    }, [sessionId, isRemote, localShell, containerId]);

    const { lines, autoScroll, setAutoScroll, bottomRef } = useLogStream(
      `${sessionId}:${containerId}`,
      start,
      ready,
    );

    return (
      <div className="absolute inset-0 z-40 flex flex-col bg-(--t-bg-base)">
        <MobileScreenHeader title={containerName} subtitle={session?.connectionName} onBack={onBack}>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className="p-2"
            style={{ color: autoScroll ? "var(--t-status-connected)" : "var(--t-text-dim)" }}
          >
            <Icon icon="lucide:chevrons-down" width={18} />
          </button>
        </MobileScreenHeader>
        <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-4 px-3 py-2 select-text">
          {lines.length === 0 && (
            <p className="text-(--t-text-dim) opacity-60 mt-2">
              {ready ? t("dockerLogsWaiting") : t("dockerLogsSessionNotConnected")}
            </p>
          )}
          {lines.map((l, i) => (
            <div key={i} className={l.stream === "stderr" ? "text-(--t-status-error)" : "text-(--t-text-primary)"}>
              {stripAnsi(l.line)}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    );
  };
}
