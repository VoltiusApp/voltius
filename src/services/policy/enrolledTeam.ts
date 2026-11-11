import { fetchEnrolledPolicy } from "@/services/enrollment/enrollmentPolicy";
import { enrollmentTokenOf, entryForToken, useEnrolledTeamStore, type EnrolledTeamEntry } from "@/stores/enrolledTeamStore";
import { onPolicyLoaded, usePolicyStore } from "@/stores/policyStore";
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

export async function syncEnrolledTeam(machinePolicy: Record<string, unknown>): Promise<void> {
  const parsed = enrollmentTokenOf(machinePolicy);
  const token = parsed && serverAllowed(parsed.serverUrl) ? parsed : null;
  const key = token ? `${token.serverUrl} ${token.id}` : "";
  const current = entryForToken(useEnrolledTeamStore.getState().entry, token);
  if (!current) clearEntry();
  if (token && lastFetch.key === key && Date.now() - lastFetch.at < FRESH_MS) return;
  const seq = ++syncSeq;
  if (!token) return;
  lastFetch = { key, at: Date.now() };
  const result = await fetchEnrolledPolicy(token, current?.revision ?? null);
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
    layer: teamLayerOf(checked),
  });
}

function syncFromMachine(): void {
  syncEnrolledTeam(usePolicyStore.getState().machine.policy).catch((e) => console.warn("[policy] enrolled team sync failed:", e));
}

export function startEnrolledTeamSync(): void {
  if (stop) return;
  const off = onPolicyLoaded(syncFromMachine);
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") syncFromMachine();
  }, SYNC_INTERVAL_MS);
  stop = () => {
    off();
    clearInterval(timer);
  };
}

export function resetEnrolledTeamSync(): void {
  stop?.();
  stop = null;
  syncSeq = 0;
  lastFetch = NO_FETCH;
}
