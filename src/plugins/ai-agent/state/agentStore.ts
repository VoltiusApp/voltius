import { create } from "zustand";
import type { ModelMessage } from "ai";
import type { PluginAPI } from "@/plugins/api";
import type { ToolDecision } from "../types";
import { createProfilesStore, type ProfilesStore } from "../provider/profilesStore";
import { createApprovalController } from "./approvalController";
import { deriveHost, allowlistKey, isAllowlistable, hasShellMetacharacter } from "./hostDerivation";
import { runAgent } from "../agent/loop";
import { createProvider } from "../provider/factory";
import { makeStreamFetch } from "../provider/fetchAdapter";
import { consumeStream } from "./conversation";

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
/** Current plugin-instance deps; set by initAgent. */
export const getAgentDeps = () => deps;
export const _setDeps = (d: AgentDeps | null) => { deps = d; };

/**
 * True when `err` is the AbortError produced by aborting `signal` (or any
 * AbortError-shaped error, in case the signal ref isn't available). Used to
 * distinguish a deliberate Stop from a genuine run failure.
 */
export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

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
  sendMessage(text: string): Promise<void>;
  stop(): void;
  _addPending(p: PendingApproval): void;
  _persistAllowlist(): void;
}

const MODE_ORDER: Mode[] = ["plan", "ask", "auto"];

let abortController: AbortController | null = null;
let ownedSessions = new Set<string>();
/** Test seam: reset the conversation-lifetime owned-session registry. */
export const _resetOwnedSessions = () => { ownedSessions = new Set(); };

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
    // Defense in depth: the store only sees {host, key}, not the originating
    // tool+args, so it can't call isAllowlistable directly — but a key that
    // itself contains a shell metacharacter could never have come from a
    // command isAllowlistable would approve, so refuse to persist it (an
    // unenforceable entry the controller would then always refuse anyway).
    if (hasShellMetacharacter(e.key)) return;
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

  stop: () => { abortController?.abort(); },

  sendMessage: async (text) => {
    if (get().runStatus === "streaming") return;
    const d = deps;
    if (!d) return;
    const activeId = await d.profiles.getActiveId();
    const profile = (await d.profiles.list()).find((p) => p.id === activeId);
    if (!profile) {
      set({ runStatus: "error", errorText: "No provider profile configured." });
      return;
    }

    set((s) => ({
      runStatus: "streaming",
      errorText: null,
      transcript: [...s.transcript, { kind: "user", text }],
      messages: [...s.messages, { role: "user", content: text }],
    }));

    let runController: AbortController | undefined;
    try {
      const apiKey = (await d.profiles.getKey(profile.id)) ?? undefined;
      const model = await createProvider(profile, { apiKey, fetch: makeStreamFetch(d.api) });
      abortController = new AbortController();
      runController = abortController;
      const result = runAgent({
        model,
        ctx: { api: d.api, approve: d.controller.approve, owned: ownedSessions },
        messages: get().messages,
        abortSignal: abortController.signal,
      });

      // Accumulates the *current* contiguous run of text deltas; reset on each
      // tool event so a multi-step reply (text -> tool call -> tool result ->
      // more text) starts a fresh assistant transcript entry per text run
      // instead of re-concatenating earlier text into the later entry.
      let assistant = "";
      await consumeStream(result.fullStream as never, {
        onText: (delta) => {
          assistant += delta;
          set((s) => {
            const t = [...s.transcript];
            const last = t[t.length - 1];
            if (last && last.kind === "assistant") t[t.length - 1] = { kind: "assistant", text: assistant };
            else t.push({ kind: "assistant", text: assistant });
            return { transcript: t };
          });
        },
        onTool: (tool, state, detail) => {
          assistant = "";
          set((s) => ({ transcript: [...s.transcript, { kind: "tool", tool, state, detail }] }));
        },
        onError: (message) => set({ runStatus: "error", errorText: message }),
      });

      const responseMessages = await result.responseMessages;
      set((s) => ({
        messages: [...s.messages, ...responseMessages],
        runStatus: s.runStatus === "error" ? "error" : "idle",
      }));
    } catch (err) {
      if (isAbortError(err, runController?.signal)) {
        // A deliberate Stop, not a failure — don't surface it as an error.
        set({ runStatus: "idle", errorText: null });
      } else {
        set({ runStatus: "error", errorText: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      abortController = null;
    }
  },
}));

export async function initAgent(api: PluginAPI): Promise<void> {
  // Owned sessions are scoped to a conversation; today a conversation lasts
  // exactly one activation, so resetting here is sufficient. Whenever a
  // "new conversation" action is added, it must reset this too, or session
  // ids from the previous conversation stay agent-owned.
  ownedSessions = new Set();
  const profiles = createProfilesStore(api);
  const controller = createApprovalController({
    getMode: () => useAgentStore.getState().mode,
    hasAllowlist: (e) => useAgentStore.getState().hasAllowlist(e),
    addPending: (p) => useAgentStore.getState()._addPending(p),
    deriveHost: (tool, args) => deriveHost(api, tool, args),
    allowlistKey,
    isAllowlistable,
  });
  deps = { api, profiles, controller };
  const [mode, allowlist] = await Promise.all([
    api.storage.get<Mode>("agentMode"),
    api.storage.get<AllowlistEntry[]>("allowlist"),
  ]);
  useAgentStore.setState({ mode: mode ?? "ask", allowlist: allowlist ?? [] });
}
