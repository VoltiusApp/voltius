import { useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useUIStore } from "@/stores/uiStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import { isNewerFeature } from "@/services/changelog";

/**
 * Once per app launch: auto-open the What's New modal when the installed feature
 * version moved past the last one the user saw (e.g. 0.2 → 0.3). Fresh installs
 * are seeded silently — no nag. Local-only, so it works offline.
 */
export function useChangelogAutoOpen() {
  useEffect(() => {
    let alive = true;
    getVersion()
      .then((current) => {
        if (!alive) return;
        const { lastSeenChangelogVersion, markChangelogSeen, openWhatsNew } = useUIStore.getState();
        if (lastSeenChangelogVersion == null) {
          markChangelogSeen(current);
          return;
        }
        if (getToggle("changelog-popup") && isNewerFeature(current, lastSeenChangelogVersion)) {
          openWhatsNew();
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
}
