import { withRemoteApply } from "@/stores/remoteApplyGuard";
import type { UserDataHandler } from "./handler";
import type { UserDataBundle, UserDataSection } from "./formats";
import { themesHandler } from "./handlers/themes";
import { uiPreferencesHandler } from "./handlers/uiPreferences";
import { shortcutsHandler } from "./handlers/shortcuts";
import { appSettingsHandler } from "./handlers/appSettings";
import { recentPeopleHandler } from "./handlers/recentPeople";

// ─── Handler registry ─────────────────────────────────────────────────────────
// Order matters for UI rendering. Adding a new settings domain:
//   1. Create handlers/<name>.ts implementing UserDataHandler
//   2. Add it here

export const USER_DATA_HANDLERS: UserDataHandler[] = [
  themesHandler,
  uiPreferencesHandler,
  shortcutsHandler,
  appSettingsHandler,
  recentPeopleHandler,
];

// ─── Build ────────────────────────────────────────────────────────────────────

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

    const localTs = localSection?.updated_at ?? new Date(0).toISOString();
    const remoteTs = remoteSection.updated_at;
    const { value, updated } = h.merge(
      localSection?.data,
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
