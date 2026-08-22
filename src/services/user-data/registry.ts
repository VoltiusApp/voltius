import { withRemoteApply } from "@/stores/remoteApplyGuard";
import type { UserDataHandler } from "./handler";
import type { UserDataBundle, UserDataSection } from "./formats";
import { themesHandler } from "./handlers/themes";
import { uiPreferencesHandler } from "./handlers/uiPreferences";
import { shortcutsHandler } from "./handlers/shortcuts";
import { appSettingsHandler } from "./handlers/appSettings";
import { recentPeopleHandler } from "./handlers/recentPeople";
import { vaultsHandler } from "./handlers/vaults";

// ─── Handler registry ─────────────────────────────────────────────────────────
// Order matters for UI rendering. Adding a new settings domain:
//   1. Create handlers/<name>.ts implementing UserDataHandler
//   2. Add it here
//   3. Add an entry to SYNC_SETTING_DOMAINS in stores/syncPrefsStore.ts, or the
//      new domain silently becomes permanently-synced (isDomainSynced defaults
//      an unknown key to true) — the drift test in syncPrefsStore.test.ts
//      fails until you do
//   4. Add the four settings.sync.settingDomain.<id>.{label,sub} locale strings

export const USER_DATA_HANDLERS: UserDataHandler[] = [
  themesHandler,
  uiPreferencesHandler,
  shortcutsHandler,
  appSettingsHandler,
  recentPeopleHandler,
  vaultsHandler,
];

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Unfiltered by design: the manual export UI produces a backup the user asked
 * for by name, and that backup must be complete regardless of sync domain
 * toggles. Only the sync path wraps this in `filterOutgoing`. A future sync
 * route reaching for a "build the bundle" function should filter its own
 * output rather than change this one.
 */
export function buildUserDataBundle(keys?: string[]): UserDataBundle {
  const handlers = keys
    ? USER_DATA_HANDLERS.filter((h) => keys.includes(h.key))
    : USER_DATA_HANDLERS;

  const sections: Record<string, UserDataSection> = {};
  for (const h of handlers) {
    sections[h.key] = { data: h.export(), updated_at: h.getTimestamp() };
  }

  return {
    type: "voltius-user-data",
    version: 2,
    exported_at: new Date().toISOString(),
    sections,
  };
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/**
 * @param opts.remote  true when the bundle came from another device's blob:
 *                     each section is applied under the remote-apply guard so
 *                     stores adopt the remote timestamp and skip the push that
 *                     would bounce the change straight back (see
 *                     stores/remoteApplyGuard).
 */
export async function applyUserDataBundle(
  bundle: UserDataBundle,
  keys?: string[],
  opts?: { remote?: boolean },
): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  for (const h of USER_DATA_HANDLERS) {
    if (keys && !keys.includes(h.key)) continue;
    const section = bundle.sections[h.key];
    if (!section) continue;
    if (opts?.remote) await withRemoteApply(section.updated_at, () => h.import(section.data));
    else await h.import(section.data);
    applied.push(h.key);
  }
  return { applied };
}

// ─── Merge (LWW per section) ──────────────────────────────────────────────────

export function mergeUserDataBundle(
  local: UserDataBundle | null,
  remote: UserDataBundle,
): { merged: UserDataBundle; updatedKeys: string[] } {
  const updatedKeys: string[] = [];
  const sections: Record<string, UserDataSection> = { ...(local?.sections ?? {}) };

  for (const h of USER_DATA_HANDLERS) {
    const localSection = local?.sections[h.key];
    const remoteSection = remote.sections[h.key];
    if (!remoteSection) continue;

    // A section missing from the bundle isn't necessarily missing data: a
    // switched-off domain is filtered OUT of settings.json before it's ever
    // written (filterOutgoing), so the merge base can lack an entry for a
    // domain whose store still holds current, possibly newer, local state.
    // The stores are local truth — settings.json is only a cache of them —
    // so fall back to the handler's live export/timestamp rather than
    // treating an absent section as "no local value", which would let
    // lastWriteWins hand a stale remote an unconditional win the moment the
    // domain is re-enabled.
    const localData = localSection ? localSection.data : h.export();
    const localTs = localSection ? localSection.updated_at : h.getTimestamp();
    const remoteTs = remoteSection.updated_at;
    const { value, updated } = h.merge(
      localData,
      remoteSection.data,
      localTs,
      remoteTs,
    );
    sections[h.key] = { data: value, updated_at: updated ? remoteTs : localTs };
    if (updated) updatedKeys.push(h.key);
  }

  return {
    merged: {
      type: "voltius-user-data",
      version: 2,
      exported_at: new Date().toISOString(),
      sections,
    },
    updatedKeys,
  };
}
