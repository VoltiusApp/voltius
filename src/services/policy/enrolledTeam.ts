import { fetchEnrolledPolicy } from "@/services/enrollment/enrollmentPolicy";
import { parseEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { useEnrolledTeamStore, type EnrolledTeamEntry } from "@/stores/enrolledTeamStore";
import { onPolicyLoaded, usePolicyStore } from "@/stores/policyStore";
import { serverAllowed } from "./serverPolicy";
import { checkTeamDoc, teamLayerOf } from "./teamPolicy";

const SYNC_INTERVAL_MS = 15 * 60_000;
const FRESH_MS = 5 * 60_000;

let syncSeq = 0;
let lastFetch = { key: "", at: -Infinity };
let started = false;

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
  const raw = machinePolicy["enrollment.token"];
  const parsed = typeof raw === "string" ? parseEnrollmentToken(raw) : null;
  const token = parsed && serverAllowed(parsed.serverUrl) ? parsed : null;
  const key = token ? `${token.serverUrl} ${token.id}` : "";
  const cached = useEnrolledTeamStore.getState().entry;
  const current = token && cached?.tokenId === token.id && cached.server === token.serverUrl ? cached : null;
  if (current && lastFetch.key === key && Date.now() - lastFetch.at < FRESH_MS) return;
  const seq = ++syncSeq;
  if (!current) clearEntry();
  if (!token) return;
  const result = await fetchEnrolledPolicy(token, current?.revision ?? null);
  lastFetch = { key, at: Date.now() };
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
  if (started) return;
  started = true;
  onPolicyLoaded(syncFromMachine);
  setInterval(() => {
    if (document.visibilityState === "visible") syncFromMachine();
  }, SYNC_INTERVAL_MS);
}
