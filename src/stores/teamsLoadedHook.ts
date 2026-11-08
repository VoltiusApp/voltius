import type { Team } from "@/services/teamService";

type TeamsLoadedHook = (prev: Team[]) => void;
let hook: TeamsLoadedHook | null = null;

export function setTeamsLoadedHook(next: TeamsLoadedHook | null): void {
  hook = next;
}

export function runTeamsLoadedHook(prev: Team[]): void {
  hook?.(prev);
}
