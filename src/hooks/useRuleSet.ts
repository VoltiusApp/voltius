import { useCallback, useEffect, useRef, useState } from "react";
import { onTeamSseEvent } from "@/services/sync";
import { getRuleSet } from "@/services/teamObjects";
import type { RuleEntry } from "@/services/permissions";

type RuleSetState = { setId: string | null; entries: RuleEntry[]; status: "loading" | "ok" | "error"; error?: string };

export function useRuleSet(teamId: string, setId: string | null): RuleSetState & { reload: () => void } {
  const [state, setState] = useState<RuleSetState>({ setId, entries: [], status: setId ? "loading" : "ok" });
  const [version, setVersion] = useState(0);
  const loadedSet = useRef<string | null>(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => onTeamSseEvent((id) => { if (id === teamId) reload(); }), [teamId, reload]);
  useEffect(() => {
    if (!setId) {
      loadedSet.current = null;
      setState({ setId, entries: [], status: "ok" });
      return;
    }
    let cancelled = false;
    const refresh = loadedSet.current === setId;
    if (!refresh) setState((s) => ({ ...s, setId, status: "loading" }));
    getRuleSet(teamId, setId).then(
      ({ entries }) => {
        if (cancelled) return;
        loadedSet.current = setId;
        setState({ setId, entries, status: "ok" });
      },
      (e) => {
        if (cancelled || refresh) return;
        setState({ setId, entries: [], status: "error", error: e instanceof Error && e.message ? e.message : undefined });
      },
    );
    return () => { cancelled = true; };
  }, [teamId, setId, version]);
  return { ...state, reload };
}
