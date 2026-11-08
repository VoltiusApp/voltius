import { useEffect, useState } from "react";
import { usePolicyStore } from "@/stores/policyStore";
import { allowedShells, listLocalShells, shellPolicyEntries } from "@/services/local";
import type { ShellOption } from "@/components/layout/newSessionItems";

export function useLocalShells(): ShellOption[] {
  const [detected, setDetected] = useState<ShellOption[]>([]);
  useEffect(() => {
    listLocalShells(true).then(setDetected).catch(() => {});
  }, []);
  usePolicyStore(() => JSON.stringify(shellPolicyEntries() ?? null));
  return allowedShells(detected);
}
