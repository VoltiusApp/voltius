import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShellOption } from "@/components/layout/newSessionItems";

/** Detected local shells from the backend (`local_list_shells`), fetched once on mount. */
export function useLocalShells(): ShellOption[] {
  const [shells, setShells] = useState<ShellOption[]>([]);
  useEffect(() => {
    invoke<ShellOption[]>("local_list_shells").then(setShells).catch(() => {});
  }, []);
  return shells;
}
