import { create } from "zustand";
import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { notify } from "@/services/saveFile";

export type PolicySource = "server" | "machine";
export interface PolicyLayer {
  policy: Record<string, unknown>;
  defaults: Record<string, unknown>;
}
export interface PolicyIssue {
  layer: "policy" | "defaults" | null;
  key: string | null;
  message: string;
}
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

function notifyIssuesOnce(issues: PolicyIssue[]) {
  const signature = issues.length ? JSON.stringify(issues) : "";
  if (signature === notifiedIssues) return;
  notifiedIssues = signature;
  if (issues.length) notify("error", i18n.t("common.policy.issues", { count: issues.length }));
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
    notifyIssuesOnce(loaded.issues);
    loadedListeners.forEach((fn) => fn());
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

export function usePolicyLock(key: string): PolicyLock {
  usePolicyStore((s) => s.server.policy[key] ?? s.machine.policy[key]);
  return lockedValue(key);
}

export const adminDefault = (key: string): unknown | undefined => firstLayerWith(key, "defaults")?.value;

export function watchPolicyVisibility() {
  if (watching) return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void usePolicyStore.getState().load();
  });
}
