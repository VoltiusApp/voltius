import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  processesStart,
  processesStop,
  processKill,
  onProcessesSnapshot,
} from "@/services/processes";
import type { ProcessSnapshot, SortCol } from "./types";
import type { TerminalSession } from "@/types";

/**
 * Shared process-list lifecycle: stream subscribe/teardown, filter+sort
 * derivation, and kill. Parameterized by `session` so both the desktop
 * ProcessPanel and the mobile screen share identical behavior.
 *
 * `localUnsupported` mirrors the desktop's Android-local guard (the OS hides
 * /proc for the app's own process), letting the caller suppress streaming for
 * unsupported local sessions while keeping the stream lifecycle here.
 */
export function useProcessList(
  session: TerminalSession | undefined,
  localUnsupported = false,
) {
  const streamIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const [snapshot, setSnapshot] = useState<ProcessSnapshot | null>(null);
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("cpu");
  const [sortAsc, setSortAsc] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);

  const stopStream = useCallback(async () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    if (streamIdRef.current) {
      await processesStop(streamIdRef.current).catch(() => {});
      streamIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (
      !session ||
      session.status !== "connected" ||
      session.type === "serial" ||
      localUnsupported
    ) {
      stopStream();
      setSnapshot(null);
      return;
    }

    let cancelled = false;

    (async () => {
      await stopStream();
      if (cancelled) return;

      try {
        const isRemote = session.type === "ssh";
        const sid = await processesStart(session.id, isRemote);
        if (cancelled) { processesStop(sid).catch(() => {}); return; }
        streamIdRef.current = sid;

        const unlisten = await onProcessesSnapshot(sid, (snap) => {
          if (cancelled) return;
          setSnapshot(snap);
        });
        if (cancelled) { unlisten(); processesStop(sid).catch(() => {}); return; }
        unlistenRef.current = unlisten;
      } catch {
        // session not ready yet, will retry on next session change
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status, localUnsupported]);

  const setSort = useCallback((col: SortCol) => {
    setSortCol((prev) => {
      if (prev === col) { setSortAsc((a) => !a); return col; }
      setSortAsc(col === "cpu" || col === "mem" ? false : true);
      return col;
    });
  }, []);

  const entries = useMemo(() => {
    if (!snapshot) return [];
    let list = snapshot.entries;

    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (e) => e.name.toLowerCase().includes(q) || e.user.toLowerCase().includes(q),
      );
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "cpu": cmp = a.cpu_percent - b.cpu_percent; break;
        case "mem": cmp = a.mem_kb - b.mem_kb; break;
        case "pid": cmp = a.pid - b.pid; break;
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "user": cmp = a.user.localeCompare(b.user); break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [snapshot, filter, sortCol, sortAsc]);

  const kill = useCallback(
    async (pid: number, force: boolean) => {
      if (!session) return;
      setKillError(null);
      try {
        await processKill(session.id, pid, session.type === "ssh", force);
      } catch (e) {
        setKillError(String(e));
      }
    },
    [session],
  );

  return {
    snapshot,
    entries,
    filter,
    setFilter,
    sortCol,
    sortAsc,
    setSort,
    kill,
    killError,
    setKillError,
  };
}
