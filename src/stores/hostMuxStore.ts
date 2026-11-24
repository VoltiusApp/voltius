import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MuxModeEvent } from "@/services/ssh";

export type MuxKind = "tmux-cc" | "tmux-old" | "screen" | "none" | "unsupported";

export interface HostMux {
  kind: MuxKind;
  version?: string;
  voltius?: { active: string; versions: string[]; inUse: Record<string, number> };
  checkedAt: number;
  notified?: MuxKind;
}

type MuxObservation = { kind: MuxKind; version?: string };

export function muxFromMode(mode: MuxModeEvent): MuxObservation | null {
  if (mode.control) return { kind: "tmux-cc", version: mode.tmux };
  const f = mode.fallback;
  if (f === "screen") return { kind: "screen" };
  if (f === "none") return { kind: "none" };
  if (f && f.startsWith("tmux ")) return { kind: "tmux-old", version: f.slice(5) };
  return null;
}

export function needsNotify(h: HostMux | undefined): boolean {
  if (!h) return false;
  return (h.kind === "tmux-old" || h.kind === "screen" || h.kind === "none") && h.notified !== h.kind;
}

interface HostMuxStore {
  hosts: Record<string, HostMux>;
  record: (connectionId: string, m: MuxObservation) => void;
  setVoltius: (connectionId: string, v: HostMux["voltius"] | undefined) => void;
  markNotified: (connectionId: string, kind: MuxKind) => void;
  forget: (connectionId: string) => void;
}

export const useHostMuxStore = create<HostMuxStore>()(
  persist(
    (set) => ({
      hosts: {},

      record: (connectionId, m) =>
        set((s) => {
          const prev = s.hosts[connectionId];
          return {
            hosts: {
              ...s.hosts,
              [connectionId]: {
                ...prev,
                kind: m.kind,
                version: m.version,
                checkedAt: Date.now(),
                notified: prev?.kind === m.kind ? prev.notified : undefined,
              },
            },
          };
        }),

      setVoltius: (connectionId, v) =>
        set((s) => {
          const prev = s.hosts[connectionId];
          if (!prev) return s;
          return { hosts: { ...s.hosts, [connectionId]: { ...prev, voltius: v } } };
        }),

      markNotified: (connectionId, kind) =>
        set((s) => {
          const prev = s.hosts[connectionId];
          if (!prev) return s;
          return { hosts: { ...s.hosts, [connectionId]: { ...prev, notified: kind } } };
        }),

      forget: (connectionId) =>
        set((s) => {
          const { [connectionId]: _removed, ...rest } = s.hosts;
          return { hosts: rest };
        }),
    }),
    { name: "voltius-host-mux", version: 1, partialize: (s) => ({ hosts: s.hosts }) },
  ),
);
