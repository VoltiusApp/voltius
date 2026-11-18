import { useEffect, useState } from "react";
import { usePolicyStore } from "@/stores/policyStore";
import { allowedShells, detectedShells, listLocalShells, shellPolicyEntries } from "@/services/local";
import type { ShellOption } from "@/components/layout/newSessionItems";

export function useLocalShellsState(): { shells: ShellOption[]; detecting: boolean } {
  const [detected, setDetected] = useState(detectedShells);
  const [detecting, setDetecting] = useState(!detected);
  useEffect(() => {
    listLocalShells(true).then(setDetected).catch(() => {}).finally(() => setDetecting(false));
  }, []);
  usePolicyStore(() => JSON.stringify(shellPolicyEntries() ?? null));
  return { shells: allowedShells(detected ?? []), detecting };
}

export const useLocalShells = (): ShellOption[] => useLocalShellsState().shells;
