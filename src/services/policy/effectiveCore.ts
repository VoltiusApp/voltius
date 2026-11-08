import type { StoreApi, UseBoundStore } from "zustand";
import { policyKeyDef } from "@/services/policy/policyKeys";
import {
  adminDefault,
  clampToRange,
  inPolicyRange,
  lockedValue,
  policyRange,
  usePolicyStore,
  type PolicyRange,
} from "@/stores/policyStore";
import { sanitizeKeywordRules } from "@/utils/keywordMatcher";

function nearestTo(candidates: Array<string | number>, target: unknown): string | number | undefined {
  if (typeof target !== "number") return candidates[0];
  const dist = (n: string | number) => Math.abs((n as number) - target);
  return candidates.reduce<string | number | undefined>(
    (best, n) => (best === undefined || dist(n) < dist(best) || (dist(n) === dist(best) && n < best) ? n : best),
    undefined,
  );
}

export function boundedValue(key: string, range: PolicyRange, stored: unknown, adminDefaultValue: unknown, builtInValue: unknown): unknown {
  const fits = [stored, adminDefaultValue, builtInValue].find((v) => v !== undefined && inPolicyRange(range, v));
  if (fits !== undefined) return fits;

  const def = policyKeyDef(key);
  const isNumber = def?.type === "number";
  const domain = def?.domain?.values;
  const allowedInDomain = () => range.allowed?.find((a) => !domain || domain.includes(a as string | number));
  if (domain) {
    const picked = isNumber ? nearestTo(domain.filter((v) => inPolicyRange(range, v)), stored) : allowedInDomain();
    if (picked !== undefined) return picked;
  }
  if (isNumber) {
    const base = typeof stored === "number" ? stored : typeof builtInValue === "number" ? builtInValue : undefined;
    if (base !== undefined) return clampToRange(range, base);
  }
  return allowedInDomain() ?? range.allowed?.[0] ?? null;
}

const MERGE_LOCK: Record<string, (lock: unknown, stored: unknown) => unknown> = {
  "appSettings.proxy": (lock, stored) => {
    const l = lock as { mode?: string; username?: string };
    const username = (stored as { username?: string } | undefined)?.username;
    const keep = l.username === undefined && username !== undefined && l.mode !== "none" && l.mode !== "system";
    return keep ? { ...l, username } : lock;
  },
  "appSettings.terminal.keywordRules": (lock, stored) => [
    ...sanitizeKeywordRules(lock),
    ...(Array.isArray(stored) ? stored : []),
  ],
  "themes.location": (lock) => ({ label: "manual", source: "manual", ...(lock as object) }),
};

export function effectiveSettingWith<T>(key: string, stored: T, builtInValue: unknown): T {
  const lock = lockedValue(key);
  if (lock.locked) return (MERGE_LOCK[key]?.(lock.value, stored) ?? lock.value) as T;
  const range = policyRange(key);
  return range ? (boundedValue(key, range, stored, adminDefault(key), builtInValue) as T) : stored;
}

export function useEffectiveSettingWith<T>(key: string, stored: T, builtInValue: unknown): T {
  usePolicyStore(() => JSON.stringify([lockedValue(key), policyRange(key) ?? null, adminDefault(key) ?? null]));
  return effectiveSettingWith(key, stored, builtInValue);
}

export function storeSetting<S, K extends keyof S>(store: UseBoundStore<StoreApi<S>>, field: K, key: string) {
  const builtInValue = () => store.getInitialState()[field];
  return {
    get: (): S[K] => effectiveSettingWith(key, store.getState()[field], builtInValue()),
    use: (): S[K] => useEffectiveSettingWith(key, store((s) => s[field]), builtInValue()),
  };
}
