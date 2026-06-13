import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { dockerStartLogStream, dockerStopLogStream, onDockerLog } from "@/plugins/docker/services";
import type { DockerLogLine } from "@/plugins/docker/types";
import MobilePanelHeader from "./MobilePanelHeader";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

export default function MobileDockerLogsScreen({
  sessionId,
  containerId,
  containerName,
}: {
  sessionId: string;
  containerId: string;
  containerName: string;
}) {
  // `.find` is a stable element ref — safe selector, never a fresh array.
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
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

    (async () => {
      setLines([]);
      await stopStream();
      if (cancelled) return;

      try {
        const sid = await dockerStartLogStream(sessionId, isRemote, localShell, containerId, 200);
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
      <MobilePanelHeader
        title={containerName}
        sessionName={session?.connectionName}
        right={
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className="p-2"
            style={{ color: autoScroll ? "var(--t-status-connected)" : "var(--t-text-dim)" }}
          >
            <Icon icon="lucide:chevrons-down" width={18} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-4 px-3 py-2 select-text">
        {lines.length === 0 && (
          <p className="text-(--t-text-dim) opacity-60 mt-2">
            {ready ? "Waiting for logs…" : "Session not connected."}
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
}
