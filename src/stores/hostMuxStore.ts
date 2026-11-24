import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MuxModeEvent } from "@/services/ssh";
import type { TmuxInstallFailure, TmuxInstallStep } from "@/services/tmuxInstall";

export type MuxKind = "tmux-cc" | "tmux-old" | "screen" | "none" | "unsupported";

export interface HostMux {
  kind: MuxKind;
  version?: string;
  voltius?: { active: string; versions: string[]; inUse: Record<string, number>; outdated: boolean };
  checkedAt: number;
  notified?: MuxKind;
}

type MuxObservation = { kind: MuxKind; version?: string };

export interface TmuxInstalling {
  step: TmuxInstallStep;
  progress: number;
  quiet: boolean;
}

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
  installing: Record<string, TmuxInstalling>;
  lastFailure: Record<string, TmuxInstallFailure>;
  record: (connectionId: string, m: MuxObservation) => void;
  setVoltius: (connectionId: string, v: HostMux["voltius"] | undefined) => void;
  markNotified: (connectionId: string, kind: MuxKind) => void;
  forget: (connectionId: string) => void;
  setInstalling: (connectionId: string, state: TmuxInstalling | undefined) => void;
  setFailure: (connectionId: string, failure: TmuxInstallFailure | undefined) => void;
}

function withEntry<T>(map: Record<string, T>, key: string, value: T | undefined): Record<string, T> {
  const { [key]: _removed, ...rest } = map;
  return value === undefined ? rest : { ...rest, [key]: value };
}

export const useHostMuxStore = create<HostMuxStore>()(
  persist(
    (set) => ({
      hosts: {},
      installing: {},
      lastFailure: {},

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

      forget: (connectionId) => set((s) => ({ hosts: withEntry(s.hosts, connectionId, undefined) })),

      setInstalling: (connectionId, state) =>
        set((s) => ({ installing: withEntry(s.installing, connectionId, state) })),

      setFailure: (connectionId, failure) =>
        set((s) => ({ lastFailure: withEntry(s.lastFailure, connectionId, failure) })),
    }),
    { name: "voltius-host-mux", version: 1, partialize: (s) => ({ hosts: s.hosts }) },
  ),
);
