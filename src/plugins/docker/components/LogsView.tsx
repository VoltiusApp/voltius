import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { dockerStopLogStream, onDockerLog } from "../services";
import type { DockerLogLine } from "../types";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

interface Props {
  streamKey: string;
  displayName: string;
  startStream: (tail: number) => Promise<string>;
  onBack: () => void;
}

export function LogsView({ streamKey, displayName, startStream, onBack }: Props) {
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
    let cancelled = false;

    (async () => {
      setLines([]);
      await stopStream();
      if (cancelled) return;

      try {
        const sid = await startStream(200);
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
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [lines, autoScroll]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--t-border)] shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-[var(--t-bg-hover)] text-[var(--t-text-muted)]"
        >
          <Icon icon="lucide:arrow-left" width={14} />
        </button>
        <span className="text-[11px] font-mono text-[var(--t-text)] truncate flex-1">
          {displayName}
        </span>
        <button
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
          className={`p-1 rounded text-[11px] ${
            autoScroll
              ? "text-[var(--t-status-connected)]"
              : "text-[var(--t-text-muted)] hover:bg-[var(--t-bg-hover)]"
          }`}
        >
          <Icon icon="lucide:chevrons-down" width={13} />
        </button>
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto font-mono text-[10px] leading-4 px-2 py-1 select-text">
        {lines.length === 0 && (
          <p className="text-[var(--t-text-muted)] opacity-50 mt-2">Waiting for logs…</p>
        )}
        {lines.map((l, i) => (
          <div
            key={i}
            className={l.stream === "stderr" ? "text-[var(--t-status-error)]" : "text-[var(--t-text)]"}
          >
            {stripAnsi(l.line)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
