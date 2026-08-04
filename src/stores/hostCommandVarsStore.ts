import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParsedVariable } from "@/services/snippetParser";

interface HostCommandVarsStore {
  /** `${connectionId} ${snippetId}` → variable values. */
  values: Record<string, Record<string, string>>;
  setEntry: (key: string, vals: Record<string, string>) => void;
  dropByConnection: (connectionId: string) => void;
}

const SEP = " ";
const key = (connectionId: string, snippetId: string) => `${connectionId}${SEP}${snippetId}`;

export const useHostCommandVarsStore = create<HostCommandVarsStore>()(
  persist(
    (set) => ({
      values: {},

      setEntry: (k, vals) =>
        set((s) => {
          if (Object.keys(vals).length === 0) {
            const { [k]: _drop, ...rest } = s.values;
            return { values: rest };
          }
          return { values: { ...s.values, [k]: vals } };
        }),

      dropByConnection: (connectionId) =>
        set((s) => ({
          values: Object.fromEntries(
            Object.entries(s.values).filter(([k]) => !k.startsWith(`${connectionId}${SEP}`)),
          ),
        })),
    }),
    { name: "voltius-host-command-vars" },
  ),
);

export function rememberedVars(connectionId: string, snippetId: string): Record<string, string> {
  return useHostCommandVarsStore.getState().values[key(connectionId, snippetId)] ?? {};
}

/** Fail-closed: only known non-password variables are persisted. */
export function rememberVars(
  connectionId: string,
  snippetId: string,
  values: Record<string, string>,
  vars: ParsedVariable[],
): void {
  const allowed = new Set(vars.filter((v) => v.type !== "password").map((v) => v.name));
  const safe = Object.fromEntries(Object.entries(values).filter(([name]) => allowed.has(name)));
  useHostCommandVarsStore.getState().setEntry(key(connectionId, snippetId), safe);
}

export function clearRememberedVars(connectionId: string): void {
  useHostCommandVarsStore.getState().dropByConnection(connectionId);
}
