import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { isPolicyEnforced } from "@/services/policy/policyKeys";

export type PolicySource = "server" | "machine";
export interface PolicyLayer {
  policy: Record<string, unknown>;
  defaults: Record<string, unknown>;
}
export type PolicyIssueKind = "file" | "type" | "unknownKey" | "newerVersion" | "range";
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

const TOASTED_KINDS: ReadonlySet<PolicyIssueKind> = new Set(["file", "type"]);

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
  notify("error", unreadable ? i18n.t("common.policy.fileError") : i18n.t("common.policy.issues", { count: errors.length }));
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

export function lockedValue(key: string): PolicyLock {
  const hit = firstLayerWith(key, "policy");
  return hit ? { locked: true, ...hit } : { locked: false };
}

export const isLocked = (key: string): boolean => lockedValue(key).locked;

function lockedAs<T>(key: string, is: (v: unknown) => v is T): T | undefined {
  const lock = lockedValue(key);
  return lock.locked && is(lock.value) ? lock.value : undefined;
}

export const lockedBool = (key: string) => lockedAs(key, (v): v is boolean => typeof v === "boolean");
export const lockedString = (key: string) => lockedAs(key, (v): v is string => typeof v === "string");
export const lockedList = (key: string) => lockedAs(key, (v): v is unknown[] => Array.isArray(v));

// Only an enforced key's lock is honoured by its read path, so only it may hold a value back.
export const isEnforcedLock = (key: string): boolean => isPolicyEnforced(key) && isLocked(key);

export function usePolicyLock(key: string): PolicyLock {
  usePolicyStore((s) => s.server.policy[key] ?? s.machine.policy[key]);
  return lockedValue(key);
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

export function watchPolicyVisibility() {
  if (watching) return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void reloadThenApplyCli();
    else void import("@/services/cliBridge").then((m) => m.writeCliMirror());
  });
}
