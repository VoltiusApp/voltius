import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import type { UserDataBundle, UserDataSection } from "./formats";

function keepSyncedSections(bundle: UserDataBundle): UserDataBundle {
  const { isDomainSynced } = useSyncPrefsStore.getState();
  const sections: Record<string, UserDataSection> = {};
  for (const [key, section] of Object.entries(bundle.sections)) {
    if (isDomainSynced(key)) sections[key] = section;
  }
  return { ...bundle, sections };
}

/**
 * The bundle as it may leave this device. Written to settings.json before
 * `backup_export` reads it, so a switched-off domain never enters the blob —
 * the guarantee is the filter, not the push trigger.
 */
export function filterOutgoing(bundle: UserDataBundle): UserDataBundle {
  return keepSyncedSections(bundle);
}

/**
 * A remote bundle as this device may consider it. Switched-off sections are
 * dropped before the merge, so remote values neither win nor reach the stores.
 */
export function filterIncoming(bundle: UserDataBundle): UserDataBundle {
  return keepSyncedSections(bundle);
}
