import { useCallback, useEffect, useRef, useState } from "react";
import { dockerStopLogStream, onDockerLog } from "./services";
import type { DockerLogLine } from "./types";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Newest lines kept in memory; older ones are dropped as the stream runs. */
const MAX_LINES = 2000;

/**
 * Runs one docker log stream for as long as `streamKey` stays the same, and
 * tails it into `lines`. Restarting on a key change and stopping the backend
 * stream on unmount is the whole point — a leaked stream keeps the remote
 * `docker logs -f` alive. Shared by the desktop LogsView and the mobile screen,
 * which differ only in chrome.
 */
export function useLogStream(streamKey: string, start: () => Promise<string>, enabled = true) {
  const [lines, setLines] = useState<DockerLogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Read at effect time, so a re-render with new stream parameters does not
  // restart the stream on its own — only a streamKey change does.
  const startRef = useRef(start);
  startRef.current = start;

  const stopStream = useCallback(async () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    if (streamIdRef.current) {
      await dockerStopLogStream(streamIdRef.current).catch(() => {});
      streamIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      setLines([]);
      await stopStream();
      if (cancelled) return;

      try {
        const sid = await startRef.current();
        if (cancelled) {
          dockerStopLogStream(sid).catch(() => {});
          return;
        }
        streamIdRef.current = sid;

        const unlisten = await onDockerLog(sid, (line) => {
          setLines((prev) => {
            const next = [...prev, line];
            if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
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
  }, [streamKey, enabled, stopStream]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [lines, autoScroll]);

  return { lines, autoScroll, setAutoScroll, bottomRef };
}
