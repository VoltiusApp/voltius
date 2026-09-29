import { useEffect, useState } from "react";
import { getRuleSet } from "@/services/teamObjects";
import type { RuleEntry } from "@/services/permissions";

type RuleSetState = { entries: RuleEntry[]; status: "loading" | "ok" | "error"; error?: string };

export function useRuleSet(teamId: string, setId: string | null): RuleSetState {
  const [state, setState] = useState<RuleSetState>({ entries: [], status: setId ? "loading" : "ok" });
  useEffect(() => {
    if (!setId) {
      setState({ entries: [], status: "ok" });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));
    getRuleSet(teamId, setId).then(
      (entries) => { if (!cancelled) setState({ entries, status: "ok" }); },
      (e) => { if (!cancelled) setState({ entries: [], status: "error", error: e instanceof Error && e.message ? e.message : undefined }); },
    );
    return () => { cancelled = true; };
  }, [teamId, setId]);
  return state;
}
