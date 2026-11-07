import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { policyKeys, isPolicyEnforced, policyKeyDef } from "@/services/policy/policyKeys";

export type PolicySource = "server" | "machine";
export interface PolicyLayer {
  policy: Record<string, unknown>;
  defaults: Record<string, unknown>;
}
export type PolicyIssueKind = "file" | "type" | "unknownKey" | "newerVersion" | "range" | "unprotected";
export interface PolicyIssue {
  kind: PolicyIssueKind;
  layer: "policy" | "defaults" | null;
  key: string | null;
  message: string;
}
export const LOCKED = "locked by policy";
export type PolicyLock = { locked: true; value: unknown; source: PolicySource } | { locked: false };

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
const SOURCES: PolicySource[] = ["server", "machine"];

const loadedListeners = new Set<() => void>();
let notifiedIssues = "";
let watching = false;

export const onPolicyLoaded = (fn: () => void): (() => void) => {
  loadedListeners.add(fn);
  return () => {
    loadedListeners.delete(fn);
  };
};

const TOASTED_KINDS: ReadonlySet<PolicyIssueKind> = new Set(["file", "type", "unprotected"]);

const isEmptyLayer = (l: PolicyLayer) => !Object.keys(l.policy).length && !Object.keys(l.defaults).length;

async function reportIssuesOnce({ doc, issues }: LoadedPolicy) {
  const signature = issues.length ? JSON.stringify(issues) : "";
  if (signature === notifiedIssues) return;
  notifiedIssues = signature;
  const errors = issues.filter((i) => TOASTED_KINDS.has(i.kind));
  for (const i of issues) if (!TOASTED_KINDS.has(i.kind)) console.warn("[policy]", [i.layer, i.key].filter(Boolean).join("."), i.message);
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
  server: EMPTY_LAYER,
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
  },
}));

function firstLayerWith(key: string, kind: keyof PolicyLayer): { source: PolicySource; value: unknown } | undefined {
  const state = usePolicyStore.getState();
  for (const source of SOURCES) {
    const entries = state[source][kind];
    if (Object.prototype.hasOwnProperty.call(entries, key)) return { source, value: entries[key] };
  }
  return undefined;
}

export interface PolicyRange {
  min?: number;
  max?: number;
  allowed?: unknown[];
}

const rangeOf = (v: unknown): PolicyRange | undefined =>
  v !== null && typeof v === "object" && Object.keys(v).length === 1 && "$range" in v
    ? (v as { $range: PolicyRange }).$range
    : undefined;

let impliers: Map<string, string[]> | undefined;

// Built on first use: the registry imports stores that import this one.
function impliersOf(key: string): string[] {
  if (!impliers) {
    impliers = new Map();
    for (const { id, implies } of policyKeys()) if (implies) impliers.set(implies, [...(impliers.get(implies) ?? []), id].sort());
  }
  return impliers.get(key) ?? [];
}

function impliedLock(key: string): PolicyLock {
  for (const id of impliersOf(key)) {
    const hit = firstLayerWith(id, "policy");
    if (hit) return { locked: true, value: true, source: hit.source };
  }
  return { locked: false };
}

export function lockedValue(key: string): PolicyLock {
  const implied = impliedLock(key);
  if (implied.locked) return implied;
  const hit = firstLayerWith(key, "policy");
  return hit && !rangeOf(hit.value) ? { locked: true, ...hit } : { locked: false };
}

export const policyRange = (key: string): PolicyRange | undefined => rangeOf(firstLayerWith(key, "policy")?.value);

export const inPolicyRange = (range: PolicyRange | undefined, v: unknown): boolean =>
  !range ||
  ((range.min === undefined || (typeof v === "number" && v >= range.min)) &&
    (range.max === undefined || (typeof v === "number" && v <= range.max)) &&
    (range.allowed === undefined || range.allowed.includes(v)));

export const clampToRange = (range: PolicyRange | undefined, v: number): number =>
  Math.min(Math.max(v, range?.min ?? v), range?.max ?? v);

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
  usePolicyStore((s) => s.server.policy[key] ?? s.machine.policy[key]);
  return policyRange(key);
}

export function usePolicyRefresh(): readonly [PolicyLayer, PolicyLayer] {
  return [usePolicyStore((s) => s.machine), usePolicyStore((s) => s.server)];
}

export const adminDefault = (key: string): unknown | undefined => firstLayerWith(key, "defaults")?.value;

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
function coalesced(run: () => Promise<void>): () => void {
  let inFlight: Promise<void> | null = null;
  return () => {
    inFlight ??= run()
      .catch((e) => console.warn("[policy] refresh failed:", e))
      .finally(() => {
        inFlight = null;
      });
  };
}

export function watchPolicyVisibility() {
  if (watching) return;
  watching = true;
  const onActive = coalesced(reloadThenApplyCli);
  const onInactive = coalesced(writeMirror);
  document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? onActive() : onInactive()));
  window.addEventListener("focus", onActive);
  window.addEventListener("blur", onInactive);
}
