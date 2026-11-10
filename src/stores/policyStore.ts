import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { isPolicyEnforced, policyKeyDef } from "@/services/policy/policyKeys";
import { rangeOf, inPolicyRange, clampToRange, type PolicyRange } from "@/services/policy/range";
import { mergeMachineAndTeam, type MergedLayer } from "@/services/policy/mergeLayers";
import { useTeamPolicyStore } from "@/stores/teamPolicyStore";

export { rangeOf, inPolicyRange, clampToRange, type PolicyRange };

export type PolicySource = "server" | "machine";
export interface PolicyLayer {
  policy: Record<string, unknown>;
  defaults: Record<string, unknown>;
}
export type PolicyIssueKind = "file" | "type" | "unknownKey" | "newerVersion" | "range" | "unprotected" | "notForTeam" | "conflict";
export interface PolicyIssue {
  kind: PolicyIssueKind;
  layer: "policy" | "defaults" | null;
  key: string | null;
  message: string;
}
export const LOCKED = "locked by policy";
export type PolicyLock = { locked: true; value: unknown; source: PolicySource; teams: string[] } | { locked: false };

interface LoadedPolicy {
  doc: PolicyLayer;
  issues: PolicyIssue[];
}

interface PolicyState {
  machine: PolicyLayer;
  server: PolicyLayer;
  issues: PolicyIssue[];
  load(): Promise<void>;
}

const EMPTY_LAYER: PolicyLayer = { policy: {}, defaults: {} };
const NO_TEAM_LAYER: MergedLayer = { policy: {}, teams: {}, issues: [] };
const serverLayer = (team: MergedLayer | null): PolicyLayer => ({ policy: team?.policy ?? {}, defaults: {} });

const loadedListeners = new Set<() => void>();
let watching = false;

export const onPolicyLoaded = (fn: () => void): (() => void) => {
  loadedListeners.add(fn);
  return () => {
    loadedListeners.delete(fn);
  };
};

const TOASTED_KINDS: ReadonlySet<PolicyIssueKind> = new Set(["file", "type", "unprotected"]);

const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

const isEmptyLayer = (l: PolicyLayer) => !Object.keys(l.policy).length && !Object.keys(l.defaults).length;

const warnIssue = (i: PolicyIssue) => console.warn("[policy]", [i.layer, i.key].filter(Boolean).join("."), i.message);

function changedIssues(): (issues: PolicyIssue[]) => boolean {
  let last = "";
  return (issues) => {
    const signature = issues.length ? JSON.stringify(issues) : "";
    if (signature === last) return false;
    last = signature;
    return true;
  };
}

const machineIssuesChanged = changedIssues();
const teamIssuesChanged = changedIssues();

async function reportIssuesOnce({ doc, issues }: LoadedPolicy) {
  if (!machineIssuesChanged(issues)) return;
  const errors = issues.filter((i) => TOASTED_KINDS.has(i.kind));
  for (const i of issues) if (!TOASTED_KINDS.has(i.kind)) warnIssue(i);
  if (!errors.length) return;
  const [{ default: i18n }, { notify }] = await Promise.all([import("@/i18n"), import("@/services/saveFile")]);
  const unreadable = isEmptyLayer(doc) && errors.some((i) => i.kind === "file");
  const message = errors.some((i) => i.kind === "unprotected")
    ? i18n.t("common.policy.unprotected")
    : unreadable
      ? i18n.t("common.policy.fileError")
      : i18n.t("common.policy.issues", { count: errors.length });
  notify("error", message);
}

export const usePolicyStore = create<PolicyState>((set) => ({
  machine: EMPTY_LAYER,
  server: serverLayer(useTeamPolicyStore.getState().layer),
  issues: [],
  async load() {
    let loaded: LoadedPolicy;
    try {
      loaded = await invoke<LoadedPolicy>("policy_load");
    } catch (e) {
      console.warn("[policy] load failed:", e);
      return;
    }
    set({
      machine: { policy: loaded.doc.policy, defaults: loaded.doc.defaults },
      issues: loaded.issues,
    });
    loadedListeners.forEach((fn) => fn());
    void reportIssuesOnce(loaded).catch(() => {});
    logTeamIssues();
  },
}));

type EffectivePolicy = ReturnType<typeof mergeMachineAndTeam>;
let effective: { machine: Record<string, unknown>; team: MergedLayer | null; view: EffectivePolicy } | undefined;

// Derived on read so a machine layer set straight into the store is merged too.
function effectivePolicy(): EffectivePolicy {
  const machine = usePolicyStore.getState().machine.policy;
  const team = useTeamPolicyStore.getState().layer;
  if (effective?.machine !== machine || effective.team !== team) {
    effective = { machine, team, view: mergeMachineAndTeam(machine, team ?? NO_TEAM_LAYER) };
  }
  return effective.view;
}

function logTeamIssues() {
  const issues = [...(useTeamPolicyStore.getState().layer?.issues ?? []), ...effectivePolicy().issues];
  if (teamIssuesChanged(issues)) issues.forEach(warnIssue);
}

useTeamPolicyStore.subscribe((s, prev) => {
  if (s.layer === prev.layer) return;
  usePolicyStore.setState({ server: serverLayer(s.layer) });
  logTeamIssues();
  loadedListeners.forEach((fn) => fn());
});

function policyEntry(key: string): { source: PolicySource; teams: string[]; value: unknown } | undefined {
  const { policy, sources } = effectivePolicy();
  return has(policy, key) ? { value: policy[key], ...sources[key] } : undefined;
}

export function policySourceOf(key: string): { source: PolicySource; teams: string[] } | undefined {
  const hit = policyEntry(key);
  return hit && { source: hit.source, teams: hit.teams };
}

export function lockedValue(key: string): PolicyLock {
  const hit = policyEntry(key);
  return hit && !rangeOf(hit.value) ? { locked: true, ...hit } : { locked: false };
}

export const policyRange = (key: string): PolicyRange | undefined => rangeOf(policyEntry(key)?.value);

export const isLocked = (key: string): boolean => lockedValue(key).locked;

function lockedAs<T>(key: string, is: (v: unknown) => v is T): T | undefined {
  const lock = lockedValue(key);
  return lock.locked && is(lock.value) ? lock.value : undefined;
}

export const lockedBool = (key: string) => lockedAs(key, (v): v is boolean => typeof v === "boolean");
export const lockedString = (key: string) => lockedAs(key, (v): v is string => typeof v === "string");
export const lockedList = (key: string) => lockedAs(key, (v): v is unknown[] => Array.isArray(v));

// Only an enforced key's lock is honoured by its read path, so only it may hold a value back.
export const isEnforcedLock = (key: string): boolean =>
  isPolicyEnforced(key) && policyKeyDef(key)?.lock !== "add" && isLocked(key);

export function writeUnlessLocked(key: string, write: () => void): void {
  if (!isEnforcedLock(key)) write();
}

export function usePolicyLock(key: string): PolicyLock {
  usePolicyStore(() => JSON.stringify(lockedValue(key)));
  return lockedValue(key);
}

export function usePolicyRange(key: string): PolicyRange | undefined {
  usePolicyStore(() => effectivePolicy().policy[key]);
  return policyRange(key);
}

export function usePolicyRefresh(): readonly [PolicyLayer, PolicyLayer] {
  return [usePolicyStore((s) => s.machine), usePolicyStore((s) => s.server)];
}

export const adminDefault = (key: string): unknown | undefined => {
  const { defaults } = usePolicyStore.getState().machine;
  return has(defaults, key) ? defaults[key] : undefined;
};

async function reloadThenApplyCli() {
  await usePolicyStore.getState().load();
  const { applyCliPending } = await import("@/services/cliBridge");
  await applyCliPending();
}

async function writeMirror() {
  const { writeCliMirror } = await import("@/services/cliBridge");
  await writeCliMirror();
}

// Focus and visibility usually fire together; the second call joins the first.
// With `trailing`, a call during a run queues one more run, since that run may have read stale data.
function coalesced(run: () => Promise<void>, trailing = false): () => void {
  let inFlight: Promise<void> | null = null;
  let queued = false;
  const start = () => {
    inFlight = run()
      .catch((e) => console.warn("[policy] refresh failed:", e))
      .finally(() => {
        inFlight = null;
        if (queued) {
          queued = false;
          start();
        }
      });
  };
  return () => {
    if (!inFlight) start();
    else if (trailing) queued = true;
  };
}

export function watchPolicyVisibility() {
  if (watching) return;
  watching = true;
  const onActive = coalesced(reloadThenApplyCli);
  const onInactive = coalesced(writeMirror);
  document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? onActive() : onInactive()));
  window.addEventListener("focus", onActive);
  window.addEventListener("voltius:policy-changed", coalesced(reloadThenApplyCli, true));
  window.addEventListener("blur", onInactive);
}
