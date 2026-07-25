import { create } from "zustand";
import type { ModelMessage } from "ai";
import type { PluginAPI } from "@/plugins/api";
import type { ToolDecision } from "../types";
import { createProfilesStore, type ProfilesStore } from "../provider/profilesStore";
import { createApprovalController } from "./approvalController";
import { deriveScope } from "./scopeDerivation";
import { allowlistCandidates, entriesEqual, isWellFormedEntry, type AllowlistEntry } from "./allowlist";
import { runAgent } from "../agent/loop";
import { createProvider } from "../provider/factory";
import { makeStreamFetch } from "../provider/fetchAdapter";
import { consumeStream } from "./conversation";
import { CONVERSATION_KEY, deserializeConversation, serializeConversation, type PersistedConversation } from "./persistence";
import { type AttachedContext, type ContextAttachment, formatContextBlock } from "./touchpoint";

export type Mode = "plan" | "ask" | "auto";
export type { AllowlistEntry } from "./allowlist";

export interface PendingApproval {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Connection id, `"local"`, or `UNKNOWN_SCOPE` when it couldn't be resolved. */
  scope: string;
  /** Every grant the card may offer for this call; `[]` hides the control. */
  grants: AllowlistEntry[];
  resolve: (d: ToolDecision) => void;
}

export type TranscriptEntry =
  | { kind: "user"; text: string; attachment?: ContextAttachment }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; tool: string; state: "call" | "result"; detail: string };

export interface AgentDeps {
  api: PluginAPI;
  profiles: ProfilesStore;
  controller: {
    approve(c: { tool: string; args: Record<string, unknown> }, generation: number): Promise<ToolDecision>;
  };
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
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  // An aborted signal alone is not proof: a genuine provider failure can land
  // in the same tick as a Stop, and reporting it as a clean cancel hides a
  // real error. Only treat a non-Error throw as an abort when the signal says so.
  if (signal?.aborted && !(err instanceof Error)) return true;
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
  /** Bumped on every profile mutation so mounted consumers re-read. */
  profilesVersion: number;
  bumpProfilesVersion(): void;
  setMode(m: Mode): void;
  cycleMode(): void;
  addAllowlist(e: AllowlistEntry): void;
  revokeAllowlist(e: AllowlistEntry): void;
  revokeAllAllowlist(): void;
  hasAllowlist(e: AllowlistEntry): boolean;
  resolveApproval(id: string, d: ToolDecision): void;
  sendMessage(text: string): Promise<void>;
  stop(): void;
  newConversation(): Promise<void>;
  /** Terminal context staged by the touchpoint, consumed by the next send. */
  pendingContext: AttachedContext | null;
  attachContext(c: AttachedContext): void;
  clearContext(): void;
  _addPending(p: PendingApproval): void;
  _persistAllowlist(): void;
  _persistConversation(): void;
  _rejectAllPending(reason: string): void;
}

const MODE_ORDER: Mode[] = ["plan", "ask", "auto"];

let abortController: AbortController | null = null;
let ownedSessions = new Set<string>();
/**
 * Clear the conversation-lifetime owned-session registry. Called from exactly
 * two places, and both are required: `initAgent` (a fresh activation owns
 * nothing) and `newConversation` (session ids must not stay agent-owned across
 * conversations). Anything else that ends a conversation must call this too.
 */
export const resetOwnedSessions = () => { ownedSessions = new Set(); };

/**
 * Generation-bound abort latch for the approval port.
 *
 * `runGeneration` is strictly monotonic: `sendMessage` bumps it once per run
 * and `initAgent` bumps it once per activation. It is never reset, cleared or
 * decremented. `abortedGeneration` is stamped with whatever `runGeneration`
 * currently is when `stop()`/`shutdownAgent()` fire.
 *
 * Every `approve()` call carries the generation of the run that dispatched it
 * — bound in `sendMessage` (see the `ctx.approve` wrapper) *before* the run
 * can reach the approval port, not read from module state inside the
 * controller. `isGenerationDead` refuses it when either
 *
 *   - that run was cancelled: `abortedGeneration === gen`, or
 *   - the store has moved past it: `runGeneration !== gen` — a newer run, or
 *     a fresh activation, supersedes the old one outright, whatever the
 *     latch happens to say.
 *
 * The second clause is what makes this windowless, and why the latch is a
 * generation pair rather than a boolean:
 *
 *   - `runGeneration` only ever grows, so once it has left `gen` it can never
 *     come back to it. A call that is dead at one suspension point is dead at
 *     every later one — there is no "un-abort".
 *   - If a later `stop()` re-stamps `abortedGeneration` away from `gen`, that
 *     can only happen once `runGeneration` has already moved past `gen`, so
 *     the second clause is already refusing the call.
 *   - Binding the generation at run dispatch (rather than capturing it inside
 *     `approve()`) also covers a tool from a superseded run whose *first*
 *     approval request happens after the bump: it still carries the dead
 *     run's generation, so it cannot inherit the live run's authority.
 */
let runGeneration = 0;
let abortedGeneration = -1;
function isGenerationDead(generation: number): boolean {
  return abortedGeneration === generation || runGeneration !== generation;
}
/**
 * Test seam: the generation a run dispatched right now would carry.
 * @internal Exists for tests only — production code must never call this.
 */
export const _currentRunGeneration = (): number => runGeneration;

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: "ask",
  allowlist: [],
  pendingApprovals: [],
  runStatus: "idle",
  errorText: null,
  transcript: [],
  messages: [],
  profilesVersion: 0,
  pendingContext: null,

  attachContext: (pendingContext) => set({ pendingContext }),
  clearContext: () => set({ pendingContext: null }),

  setMode: (mode) => set({ mode }),
  cycleMode: () => set((s) => ({ mode: MODE_ORDER[(MODE_ORDER.indexOf(s.mode) + 1) % 3] })),
  bumpProfilesVersion: () => set((s) => ({ profilesVersion: s.profilesVersion + 1 })),

  hasAllowlist: (e) => get().allowlist.some((a) => entriesEqual(a, e)),
  addAllowlist: (e) => {
    // Same predicate the hydrate filter uses, so a grant the store accepts is
    // always one the gate can actually enforce.
    if (!isWellFormedEntry(e)) return;
    if (get().hasAllowlist(e)) return;
    set((s) => ({ allowlist: [...s.allowlist, e] }));
    get()._persistAllowlist();
  },
  revokeAllowlist: (e) => {
    set((s) => ({ allowlist: s.allowlist.filter((a) => !entriesEqual(a, e)) }));
    get()._persistAllowlist();
  },
  revokeAllAllowlist: () => {
    set({ allowlist: [] });
    get()._persistAllowlist();
  },
  _persistAllowlist: () => { void deps?.api.storage.set("allowlist", get().allowlist); },
  _persistConversation: () => {
    const { transcript, messages } = get();
    void deps?.api.storage.set(CONVERSATION_KEY, serializeConversation(transcript, messages));
  },

  resolveApproval: (id, d) => {
    const p = get().pendingApprovals.find((x) => x.id === id);
    if (!p) return;
    p.resolve(d);
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((x) => x.id !== id) }));
  },
  _addPending: (p) => set((s) => ({ pendingApprovals: [...s.pendingApprovals, p] })),
  _rejectAllPending: (reason) => {
    for (const p of get().pendingApprovals) p.resolve({ approve: false, reason });
    set({ pendingApprovals: [] });
  },

  stop: () => {
    abortController?.abort();
    // Marks the run currently in flight (or about to start) as aborted, for
    // any `approve()` call that is mid-flight right now — parked in
    // `deriveScope`, or about to be dispatched in `auto` mode — not just the
    // pending cards that already exist. See isGenerationDead above.
    abortedGeneration = runGeneration;
    // A parked approval card belongs to the run that just got cancelled —
    // clicking Approve on it after Stop would run a command the user just
    // said no to, and leaving it unresolved leaks the promise forever.
    get()._rejectAllPending("aborted");
  },

  newConversation: async () => {
    // Same cancellation sequence as stop(), because a new conversation must
    // not leave the old one's run or cards alive…
    abortController?.abort();
    abortedGeneration = runGeneration;
    get()._rejectAllPending("superseded");
    // …and the bump is what kills an approval parked in deriveScope: it can
    // never come back to this generation. See isGenerationDead above.
    runGeneration += 1;
    // Ownership drops, but agent-owned SSH sessions are left open — closing
    // them here could race a session the user is still reading, the same
    // reasoning shutdownAgent's comment records.
    resetOwnedSessions();
    set({ transcript: [], messages: [], runStatus: "idle", errorText: null, pendingContext: null });
    const api = deps?.api;
    void api?.storage.delete(CONVERSATION_KEY);
    const stored = await api?.storage.get<Mode>("agentMode");
    set({ mode: stored ?? "ask" });
  },

  sendMessage: async (text) => {
    if (get().runStatus === "streaming") return;
    const d = deps;
    if (!d) return;
    const activeId = await d.profiles.getActiveId();
    const profiles = await d.profiles.list();
    // A teardown (or a re-activation) can land in either await above. Going
    // on would bump the generation — which is this run's abort-latch reset —
    // and drive an entire approvable run through the torn-down PluginAPI
    // captured in `d`. Bail before anything is mutated: no generation bump,
    // no "streaming" status to get stuck in, no run.
    if (deps !== d) return;
    const profile = profiles.find((p) => p.id === activeId);
    if (!profile) {
      set({ runStatus: "error", errorText: "No provider profile configured." });
      return;
    }

    // Bumping the generation IS the abort-latch reset for this new run — see
    // isGenerationDead above. Must happen before any tool call in this run
    // can reach the approval port.
    runGeneration += 1;
    // Bound once, here, for every approval this run will ever request.
    const generation = runGeneration;
    // A card already registered by the superseded run is generation-blind at
    // resolveApproval — clicking Approve on it would execute a tool for a run
    // the user just replaced. isGenerationDead alone doesn't catch this case:
    // it only re-gates approve() at suspension points *before* a card exists
    // (see approvalController's two isAborted checks); once addPending has
    // run, nothing re-checks the generation. Reap explicitly, right beside the
    // bump, so no card from run N survives into run N+1.
    get()._rejectAllPending("superseded");
    // Read at send time, not before the awaits above: the user may have
    // removed the chip while the profile lookups were in flight.
    const attached = get().pendingContext;
    set((s) => ({
      runStatus: "streaming",
      errorText: null,
      pendingContext: null,
      transcript: [
        ...s.transcript,
        attached
          ? {
              kind: "user" as const,
              text,
              attachment: {
                source: attached.source,
                lineCount: attached.lineCount,
                connectionName: attached.connectionName,
                truncated: attached.truncated,
              },
            }
          : { kind: "user" as const, text },
      ],
      messages: [
        ...s.messages,
        { role: "user", content: attached ? `${text}\n\n${formatContextBlock(attached)}` : text },
      ],
    }));

    let runController: AbortController | undefined;
    try {
      const apiKey = (await d.profiles.getKey(profile.id)) ?? undefined;
      const model = await createProvider(profile, { apiKey, fetch: makeStreamFetch(d.api) });
      abortController = new AbortController();
      runController = abortController;
      const result = runAgent({
        model,
        ctx: {
          api: d.api,
          // Every tool call this run makes is stamped with this run's
          // generation, whenever it happens to reach the port.
          approve: (call) => d.controller.approve(call, generation),
          owned: ownedSessions,
        },
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
      // Gate on superseded-ness, not isGenerationDead: an aborted run is still
      // this run (runGeneration === generation) and must persist below, but a
      // run a newer sendMessage/initAgent has moved past must not durably
      // write its stale responseMessages over the current activation's state.
      if (runGeneration === generation) get()._persistConversation();
    } catch (err) {
      if (isAbortError(err, runController?.signal)) {
        // A deliberate Stop, not a failure — don't surface it as an error.
        set({ runStatus: "idle", errorText: null });
      } else {
        set({ runStatus: "error", errorText: err instanceof Error ? err.message : String(err) });
      }
      // Exactly one of the try branch above or this catch runs per turn, so
      // this is the single write for the error/abort path — never per delta.
      // plugin_storage_set rewrites the whole per-plugin file (which also
      // holds the allowlist), so writes are batched to turn boundaries only.
      // Same superseded-only gate as above: isGenerationDead would be true
      // for an aborted-but-current run and wrongly skip persisting the user
      // message that abort path exists to keep.
      if (runGeneration === generation) get()._persistConversation();
    } finally {
      // Only the run that installed this controller may clear it — a slower
      // run finishing must not null the controller a newer run is using.
      if (abortController === runController) abortController = null;
    }
  },
}));

export async function initAgent(api: PluginAPI): Promise<void> {
  // A fresh activation owns nothing yet. See resetOwnedSessions above for the
  // invariant this shares with newConversation.
  resetOwnedSessions();
  // Symmetric with shutdownAgent: an orphan card from a dead activation
  // (e.g. teardown was skipped, or I1's abort races before this fix) must
  // not survive into a re-enabled drawer — approving it would resolve a tool
  // closure holding the stale PluginAPI that _setDeps(null) exists to guard
  // against.
  useAgentStore.getState()._rejectAllPending("aborted");
  // A fresh activation supersedes everything the previous one had in flight.
  // Bumping the generation (rather than clearing `abortedGeneration`) is what
  // makes that true: it kills every outstanding approval from the previous
  // activation — including one parked in `deriveScope`, which a latch *reset*
  // would instead have brought back to life inside the re-enabled drawer,
  // still holding the stale PluginAPI `_setDeps(null)` exists to guard
  // against. It also gives this activation a clean latch for free, since
  // `abortedGeneration` can only ever have been stamped with an older
  // generation number.
  runGeneration += 1;
  const profiles = createProfilesStore(api);
  const controller = createApprovalController({
    getMode: () => useAgentStore.getState().mode,
    hasAllowlist: (e) => useAgentStore.getState().hasAllowlist(e),
    addPending: (p) => useAgentStore.getState()._addPending(p),
    deriveScope: (tool, args) => deriveScope(api, tool, args),
    allowlistCandidates,
    isAborted: isGenerationDead,
  });
  deps = { api, profiles, controller };
  // Wrapped so a throw here — storage.get rejecting, or deserializeConversation
  // meeting a shape its checks miss on a hand-edited file — can never abort
  // this function, since that would also take down the mode/allowlist hydrate
  // below. Any failure is treated exactly like "no persisted data".
  const readConversation = async (): Promise<PersistedConversation | null> => {
    try {
      return deserializeConversation(await api.storage.get<unknown>(CONVERSATION_KEY));
    } catch {
      return null;
    }
  };
  const [mode, allowlist, restored] = await Promise.all([
    api.storage.get<Mode>("agentMode"),
    api.storage.get<AllowlistEntry[]>("allowlist"),
    readConversation(),
  ]);
  // runStatus/errorText are reset here too (not just in shutdownAgent) so a
  // re-enable is always clean even if teardown was skipped — otherwise a
  // stale "streaming" status left over from a prior activation would trip
  // sendMessage's single-flight guard and permanently brick the composer.
  useAgentStore.setState({
    mode: mode ?? "ask",
    // Legacy 3a entries were {host, key} first-token prefixes; reading them
    // forward would resurrect the over-broad grant this slice removes.
    allowlist: Array.isArray(allowlist) ? allowlist.filter(isWellFormedEntry) : [],
    runStatus: "idle",
    errorText: null,
    // Spread-conditional, not an unconditional assignment: teardown
    // deliberately preserves the conversation, so a re-activation with no (or
    // unreadable) persisted data must leave what is already in the store
    // alone rather than wiping it.
    ...(restored ? { transcript: restored.transcript, messages: restored.messages } : {}),
  });
}

/**
 * Tear down the running agent: abort any in-flight run, reject and clear
 * every pending approval (so a stale card can't be approved into executing
 * after the plugin is gone), reset run state to idle, and invalidate deps so
 * a disabled plugin instance can't keep driving tools through a stale
 * `PluginAPI`. Order matters — deps must be the last thing cleared so the
 * abort and pending-rejection above can still see a live store.
 *
 * Reset: `runStatus`, `errorText`, `pendingApprovals` (rejected, not just
 * cleared), the abort latch (`abortedGeneration` stamped with the current
 * generation, exactly as `stop()` does — killing every approval the current
 * run could still request), and `deps` (invalidated, not merely reset).
 *
 * Deliberately preserved: `transcript` and `messages` survive teardown, so
 * the conversation is still there if the agent is re-enabled. This can leave
 * `messages` referencing session ids the torn-down activation owned — that's
 * safe, not a bug: `initAgent` always starts the next activation with a
 * fresh, empty `ownedSessions`, so if the model later recalls one of those
 * ids, `run_command`'s `ctx.owned.has(sessionId)` check fails closed with
 * "session not owned by agent" instead of resuming a session this activation
 * never opened. The same reasoning covers restore across app restarts:
 * `ownedSessions` is never persisted, so a conversation restored from disk
 * naming a session id from a previous run fails closed the same way.
 *
 * Closing agent-owned SSH sessions here is deliberately out of scope: the
 * runtime's session-ownership story isn't settled, and closing on teardown
 * could race a session the user is still looking at.
 */
export function shutdownAgent(): void {
  abortController?.abort();
  abortedGeneration = runGeneration;
  useAgentStore.getState()._rejectAllPending("aborted");
  useAgentStore.setState({ runStatus: "idle", errorText: null });
  _setDeps(null);
}
