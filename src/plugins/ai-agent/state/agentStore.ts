import { create } from "zustand";
import type { ModelMessage } from "ai";
import type { PluginAPI } from "@/plugins/api";
import type { ToolDecision } from "../types";
import { createProfilesStore, type ProfilesStore } from "../provider/profilesStore";
import { createApprovalController } from "./approvalController";
import { deriveHost, allowlistKey } from "./hostDerivation";

export type Mode = "plan" | "ask" | "auto";
export interface AllowlistEntry { host: string; key: string }

export interface PendingApproval {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  host: string;
  allowlistKey: string;
  resolve: (d: ToolDecision) => void;
}

export type TranscriptEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; tool: string; state: "call" | "result"; detail: string };

export interface AgentDeps {
  api: PluginAPI;
  profiles: ProfilesStore;
  controller: { approve(c: { tool: string; args: Record<string, unknown> }): Promise<ToolDecision> };
}

let deps: AgentDeps | null = null;
export const _getDeps = () => deps; // test seam
export const _setDeps = (d: AgentDeps | null) => { deps = d; };

interface AgentState {
  mode: Mode;
  allowlist: AllowlistEntry[];
  pendingApprovals: PendingApproval[];
  runStatus: "idle" | "streaming" | "error";
  errorText: string | null;
  transcript: TranscriptEntry[];
  messages: ModelMessage[];
  setMode(m: Mode): void;
  cycleMode(): void;
  addAllowlist(e: AllowlistEntry): void;
  revokeAllowlist(e: AllowlistEntry): void;
  hasAllowlist(e: AllowlistEntry): boolean;
  resolveApproval(id: string, d: ToolDecision): void;
  _addPending(p: PendingApproval): void;
  _persistAllowlist(): void;
}

const MODE_ORDER: Mode[] = ["plan", "ask", "auto"];

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: "ask",
  allowlist: [],
  pendingApprovals: [],
  runStatus: "idle",
  errorText: null,
  transcript: [],
  messages: [],

  setMode: (mode) => set({ mode }),
  cycleMode: () => set((s) => ({ mode: MODE_ORDER[(MODE_ORDER.indexOf(s.mode) + 1) % 3] })),

  hasAllowlist: (e) => get().allowlist.some((a) => a.host === e.host && a.key === e.key),
  addAllowlist: (e) => {
    if (get().hasAllowlist(e)) return;
    set((s) => ({ allowlist: [...s.allowlist, e] }));
    get()._persistAllowlist();
  },
  revokeAllowlist: (e) => {
    set((s) => ({ allowlist: s.allowlist.filter((a) => !(a.host === e.host && a.key === e.key)) }));
    get()._persistAllowlist();
  },
  _persistAllowlist: () => { void deps?.api.storage.set("allowlist", get().allowlist); },

  resolveApproval: (id, d) => {
    const p = get().pendingApprovals.find((x) => x.id === id);
    if (!p) return;
    p.resolve(d);
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((x) => x.id !== id) }));
  },
  _addPending: (p) => set((s) => ({ pendingApprovals: [...s.pendingApprovals, p] })),
}));

export async function initAgent(api: PluginAPI): Promise<void> {
  const profiles = createProfilesStore(api);
  const controller = createApprovalController({
    getMode: () => useAgentStore.getState().mode,
    hasAllowlist: (e) => useAgentStore.getState().hasAllowlist(e),
    addPending: (p) => useAgentStore.getState()._addPending(p),
    deriveHost: (tool, args) => deriveHost(api, tool, args),
    allowlistKey,
  });
  deps = { api, profiles, controller };
  const [mode, allowlist] = await Promise.all([
    api.storage.get<Mode>("agentMode"),
    api.storage.get<AllowlistEntry[]>("allowlist"),
  ]);
  useAgentStore.setState({ mode: mode ?? "ask", allowlist: allowlist ?? [] });
}
