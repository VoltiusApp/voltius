import { useEffect, useState } from "react";
import { getAccountMode } from "@/services/account";

/**
 * `getAccountMode()` reads the keychain over IPC. Several components in the same
 * render tree (VaultHeader, useVaultAdmin, …) want the same answer at mount, so a
 * module-scoped promise lets every caller share one IPC round trip instead of each
 * firing its own.
 */
let cache: { mode: string | null } | null = null;
let inflight: Promise<string | null> | null = null;

function loadAccountMode(): Promise<string | null> {
  if (cache) return Promise.resolve(cache.mode);
  if (!inflight) {
    inflight = getAccountMode()
      .catch(() => null)
      .then((mode) => {
        cache = { mode };
        inflight = null;
        return mode;
      });
  }
  return inflight;
}

/** The current account mode ("server", "local", …), or null while it is still loading. */
export function useAccountMode(): string | null {
  const [mode, setMode] = useState<string | null>(cache?.mode ?? null);

  useEffect(() => {
    let alive = true;
    loadAccountMode().then((m) => { if (alive) setMode(m); });
    return () => { alive = false; };
  }, []);

  return mode;
}
