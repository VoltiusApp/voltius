import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@voltius/ui";
import type { FC } from "react";
import type { DockerTarget, PluginAPI, MobileScreenProps } from "@/plugins/api";
import { useSessionById } from "../useSessionById";
import { dockerStartLogStream, dockerStopLogStream, onDockerLog } from "../services";
import type { DockerLogLine } from "../types";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

export function createMobileDockerLogsScreen(api: PluginAPI): FC<MobileScreenProps> {
  return function MobileDockerLogsScreen(props) {
    const { sessionId, onBack } = props;
    const containerId = props.containerId as string;
    const containerName = props.containerName as string;

    const session = useSessionById(api, sessionId);
    const isRemote = session?.type === "ssh";
    const localShell = session?.type === "local" ? (session.localShell ?? null) : null;
    const ready = session?.type === "ssh" && session.status === "connected";

    const [lines, setLines] = useState<DockerLogLine[]>([]);
    const [autoScroll, setAutoScroll] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);
    const streamIdRef = useRef<string | null>(null);
    const unlistenRef = useRef<(() => void) | null>(null);

    const stopStream = useCallback(async () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
      if (streamIdRef.current) {
        await dockerStopLogStream(streamIdRef.current).catch(() => {});
        streamIdRef.current = null;
      }
    }, []);

    useEffect(() => {
      if (!ready) return;
      let cancelled = false;
      const target: DockerTarget = { sessionId, isRemote: !!isRemote, localShell };

      (async () => {
        setLines([]);
        await stopStream();
        if (cancelled) return;

        try {
          const sid = await dockerStartLogStream(target, containerId, 200);
          if (cancelled) {
            dockerStopLogStream(sid).catch(() => {});
            return;
          }
          streamIdRef.current = sid;

          const unlisten = await onDockerLog(sid, (line) => {
            setLines((prev) => {
              const next = [...prev, line];
              if (next.length > 2000) next.splice(0, next.length - 2000);
              return next;
            });
          });

          if (cancelled) {
            unlisten();
            dockerStopLogStream(sid).catch(() => {});
            return;
          }
          unlistenRef.current = unlisten;
        } catch (e) {
          console.error("[docker] log stream failed:", e);
        }
      })();

      return () => {
        cancelled = true;
        void stopStream();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, containerId, ready]);

    useEffect(() => {
      if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }, [lines, autoScroll]);

    return (
      <div className="absolute inset-0 z-40 flex flex-col bg-(--t-bg-base)">
        <header className="shrink-0 flex items-center gap-2 px-2 h-12 border-b" style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
          <button data-mobile-back onClick={onBack} className="p-2 text-(--t-text-primary)">
            <Icon icon="lucide:arrow-left" width={22} />
          </button>
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-base font-semibold text-(--t-text-primary) leading-tight truncate">{containerName}</span>
            {session?.connectionName && (
              <span className="text-[11px] text-(--t-text-dim) leading-tight truncate">{session.connectionName}</span>
            )}
          </span>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className="p-2"
            style={{ color: autoScroll ? "var(--t-status-connected)" : "var(--t-text-dim)" }}
          >
            <Icon icon="lucide:chevrons-down" width={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-4 px-3 py-2 select-text">
          {lines.length === 0 && (
            <p className="text-(--t-text-dim) opacity-60 mt-2">
              {ready ? "Waiting for logs…" : "Session not connected"}
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
