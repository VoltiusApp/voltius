import { clientVersion } from "@/services/clientHeaders";
import { fetchEnrolledPolicy } from "@/services/enrollment/enrollmentPolicy";
import type { Team } from "@/services/teamService";
import { enrollmentTokenOf, entryForToken, useEnrolledTeamStore, type EnrolledTeamEntry } from "@/stores/enrolledTeamStore";
import { onPolicyLoaded, usePolicyStore } from "@/stores/policyStore";
import { useTeamStore } from "@/stores/teamStore";
import { serverAllowed } from "./serverPolicy";
import { checkTeamDoc, teamLayerOf } from "./teamPolicy";

const SYNC_INTERVAL_MS = 15 * 60_000;
const FRESH_MS = 5 * 60_000;

const NO_FETCH = { key: "", at: -Infinity };

let syncSeq = 0;
let lastFetch = NO_FETCH;
let stop: (() => void) | null = null;

const setEntry = (entry: EnrolledTeamEntry | null) => useEnrolledTeamStore.getState().setEntry(entry);

function clearEntry(): void {
  if (useEnrolledTeamStore.getState().entry) setEntry(null);
}

function renamed(entry: EnrolledTeamEntry, name: string): EnrolledTeamEntry {
  const teams = Object.fromEntries(
    Object.entries(entry.layer.teams).map(([key, names]) => [key, names.map((n) => (n === entry.teamName ? name : n))]),
  );
  return { ...entry, teamName: name, layer: { ...entry.layer, teams } };
}

export async function syncEnrolledTeam(machinePolicy: Record<string, unknown>, { force = false } = {}): Promise<void> {
  const parsed = enrollmentTokenOf(machinePolicy);
  const token = parsed && serverAllowed(parsed.serverUrl) ? parsed : null;
  const current = entryForToken(useEnrolledTeamStore.getState().entry, token);
  if (!current) clearEntry();
  if (!token) {
    syncSeq++;
    lastFetch = NO_FETCH;
    return;
  }
  const key = `${token.serverUrl} ${token.id}`;
  if (!force && lastFetch.key === key && Date.now() - lastFetch.at < FRESH_MS) return;
  const seq = ++syncSeq;
  lastFetch = { key, at: Date.now() };
  const version = await clientVersion();
  const sameClient = current?.clientVersion === version ? current : null;
  const result = await fetchEnrolledPolicy(token, sameClient?.revision ?? null);
  if (seq !== syncSeq) return;
  if (result.kind === "drop") return clearEntry();
  if (result.kind === "unchanged") {
    if (current && current.teamName !== result.name) setEntry(renamed(current, result.name));
    return;
  }
  if (result.kind === "keep") return;
  const { team } = result;
  const checked = team.policy ? [await checkTeamDoc({ team, text: JSON.stringify(team.policy) })] : [];
  if (seq !== syncSeq) return;
  setEntry({
    tokenId: token.id,
    server: token.serverUrl,
    teamId: team.id,
    teamName: team.name,
    revision: team.policyRevision,
    clientVersion: version,
    layer: teamLayerOf(checked),
  });
}

async function syncFromMachine(force = false): Promise<void> {
  const { machine, machineLoaded, issues } = usePolicyStore.getState();
  if (!machineLoaded || issues.some((i) => i.kind === "file")) return;
  await syncEnrolledTeam(machine.policy, { force }).catch((e) => console.warn("[policy] enrolled team sync failed:", e));
}

async function syncOnRevision(teams: Pick<Team, "id" | "policy_revision">[]): Promise<void> {
  const entry = useEnrolledTeamStore.getState().entry;
  if (!entry) return;
  const revision = teams.find((t) => t.id === entry.teamId)?.policy_revision;
  if (revision !== undefined && revision > entry.revision) await syncFromMachine(true);
}

export function startEnrolledTeamSync(): void {
  if (stop) return;
  const off = onPolicyLoaded(() => void syncFromMachine());
  const unsubscribe = useTeamStore.subscribe((s, prev) => {
    if (s.teams !== prev.teams) void syncOnRevision(s.teams);
  });
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") void syncFromMachine();
  }, SYNC_INTERVAL_MS);
  stop = () => {
    off();
    unsubscribe();
    clearInterval(timer);
  };
}

export function resetEnrolledTeamSync(): void {
  stop?.();
  stop = null;
  syncSeq = 0;
  lastFetch = NO_FETCH;
}
