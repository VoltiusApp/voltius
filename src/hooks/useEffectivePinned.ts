import { useTeamObjectPrefsStore, type PinSource } from "@/stores/teamObjectPrefsStore";
import { useTeamStore } from "@/stores/teamStore";

interface PinnableObject {
  id: string;
  pinned?: boolean;
  favorite?: boolean;
  vault_id?: string;
}

type ObjectType = "connection" | "identity" | "key" | "snippet" | "folder" | "snippet_folder";

function resolveTeamId(obj: PinnableObject, teamIdHint?: string): string | undefined {
  if (teamIdHint) return teamIdHint;
  if (!obj.vault_id) return undefined;
  const teams = useTeamStore.getState().teams;
  return teams.some((t) => t.id === obj.vault_id) ? obj.vault_id : undefined;
}

function getTeamDefaultPin(obj: PinnableObject, type: ObjectType): boolean {
  return type === "snippet" ? obj.favorite === true : obj.pinned === true;
}

/**
 * Effective pin state for an object — folds personal-pref override (team vault)
 * over the team default. For personal-vault items, returns the raw field.
 */
export function useEffectivePinned(
  obj: PinnableObject,
  type: ObjectType,
  teamIdHint?: string,
): boolean {
  const teamId = resolveTeamId(obj, teamIdHint);
  const personal = useTeamObjectPrefsStore((s) =>
    teamId ? s.prefs[teamId]?.[obj.id]?.pinned : undefined,
  );
  if (!teamId) {
    return getTeamDefaultPin(obj, type);
  }
  if (personal !== null && personal !== undefined) return personal;
  return getTeamDefaultPin(obj, type);
}

export function useEffectivePinSource(
  obj: PinnableObject,
  type: ObjectType,
  teamIdHint?: string,
): PinSource {
  const teamId = resolveTeamId(obj, teamIdHint);
  const personal = useTeamObjectPrefsStore((s) =>
    teamId ? s.prefs[teamId]?.[obj.id]?.pinned : undefined,
  );
  if (!teamId) {
    return getTeamDefaultPin(obj, type) ? "personal" : "none";
  }
  const team = getTeamDefaultPin(obj, type);
  if (personal === true && team) return "team+personal";
  if (personal === true && !team) return "personal";
  if (personal === false && team) return "team-hidden";
  if (personal === false && !team) return "none";
  return team ? "team" : "none";
}

/**
 * Compute the next personal-pref value when the user single-clicks the pin icon.
 * Three-state cycle on team-default items: team → hide → inherit → team.
 */
export function nextPersonalPinValue(
  source: PinSource,
): boolean | null {
  switch (source) {
    case "none":
      return true;
    case "personal":
      return null;
    case "team":
      return false;
    case "team+personal":
      return null;
    case "team-hidden":
      return null;
  }
}

/**
 * Non-hook variant for sort/filter call sites (selectors, group functions).
 * Reads current prefs store state synchronously.
 */
export function effectivePinned(
  obj: PinnableObject,
  type: ObjectType,
  teamIdHint?: string,
): boolean {
  const teamId = resolveTeamId(obj, teamIdHint);
  if (!teamId) return getTeamDefaultPin(obj, type);
  const personal = useTeamObjectPrefsStore.getState().prefs[teamId]?.[obj.id]?.pinned;
  if (personal !== null && personal !== undefined) return personal;
  return getTeamDefaultPin(obj, type);
}

/**
 * Reactive predicate for filtering/sorting lists. The returned function reads
 * the latest prefs snapshot; the component re-renders when prefs change.
 */
export function useEffectivePinnedPredicate(): (
  obj: PinnableObject,
  type: ObjectType,
  teamIdHint?: string,
) => boolean {
  const prefs = useTeamObjectPrefsStore((s) => s.prefs);
  return (obj, type, teamIdHint) => {
    const teamId = resolveTeamId(obj, teamIdHint);
    if (!teamId) return getTeamDefaultPin(obj, type);
    const personal = prefs[teamId]?.[obj.id]?.pinned;
    if (personal !== null && personal !== undefined) return personal;
    return getTeamDefaultPin(obj, type);
  };
}
