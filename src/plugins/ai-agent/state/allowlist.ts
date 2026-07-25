import { COMMAND_CARRYING_TOOLS, hasShellMetacharacter, isAllowlistable } from "./scopeDerivation";

/**
 * How broadly a remembered approval applies.
 *
 * - `tool`  — the whole tool on a host (`open_session` on `ssh-host-1`).
 * - `exact` — one exact command line, and nothing else.
 *
 * There is deliberately no coarser "binary plus any arguments" grade. An
 * earlier revision tried to offer one, gated by a curated positive list of
 * binaries believed to be exec-free and non-mutating. Two independent
 * security audits of that list each found violations the previous audit had
 * missed — `ip netns exec <ns> <cmd>` runs arbitrary commands, `ss -K`
 * forcibly kills sockets — which means "a binary with no dangerous flag" is
 * not a property that can be reliably enumerated. Do not reintroduce it;
 * narrow the individual grants instead.
 */
export type AllowlistGrain = "tool" | "exact";

export interface AllowlistEntry {
  /** Connection id, or the literal "local". Never a hostname — see deriveScope. */
  scope: string;
  tool: string;
  grain: AllowlistGrain;
  /** Tool name (`tool`) or full trimmed command (`exact`). */
  key: string;
}

/**
 * Trim only. Internal whitespace is NOT collapsed: `grep 'a  b' f` and
 * `grep 'a b' f` are different commands, because the argument is quoted, and a
 * grant for one must never match the other. More approval cards is the correct
 * trade against unsound matching.
 */
export function normalizeCommand(cmd: string): string {
  return cmd.trim();
}

/**
 * Every allowlist entry that would authorize this call — the single source of
 * truth shared by the approval gate (which asks whether any candidate is
 * stored) and the approval card (which offers the candidates as grants). One
 * function for both is what stops the UI and the gate from drifting apart.
 *
 * Always returns at most one candidate: grants are exact-command only now (see
 * {@link AllowlistGrain}), so there is no second, broader grade to offer
 * alongside it.
 *
 * Returns `[]` when nothing may be granted, which is also the fail-closed
 * answer for a command carrying a shell metacharacter.
 */
export function allowlistCandidates(
  tool: string,
  args: Record<string, unknown>,
  scope: string,
): AllowlistEntry[] {
  if (!isAllowlistable(tool, args)) return [];
  if (!COMMAND_CARRYING_TOOLS.has(tool)) {
    return [{ scope, tool, grain: "tool", key: tool }];
  }
  const command = normalizeCommand(String(args.command ?? ""));
  if (!command) return [];
  return [{ scope, tool, grain: "exact", key: command }];
}

/**
 * Validates a persisted entry. Applied on hydrate, so 3a's legacy
 * `{host, key}` entries (which were first-token PREFIXES) are discarded rather
 * than read forward as grants — that would resurrect exactly the hole this
 * slice closes. The same field check also drops 3b's `{host,…}` entries now
 * that the field is `scope`: a grant keyed on a shared hostname, made under
 * one connection, must not survive to auto-approve a different connection to
 * that same host. Also rejects any shape {@link allowlistCandidates} could
 * never emit — `grain` must agree with whether `tool` is command-carrying,
 * and a `tool`-grain entry's `key` must equal its `tool` — so a stale or
 * hand-edited entry from the removed `prefix` tier gets cleaned up here
 * rather than surviving inert on disk.
 */
export function isWellFormedEntry(value: unknown): value is AllowlistEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (typeof e.scope !== "string" || e.scope.length === 0) return false;
  if (typeof e.tool !== "string" || e.tool.length === 0) return false;
  if (typeof e.key !== "string" || e.key.length === 0) return false;
  if (e.grain !== "tool" && e.grain !== "exact") return false;
  if (hasShellMetacharacter(e.key)) return false;
  const commandCarrying = COMMAND_CARRYING_TOOLS.has(e.tool);
  if (e.grain === "exact" && !commandCarrying) return false;
  if (e.grain === "tool" && commandCarrying) return false;
  if (e.grain === "tool" && e.key !== e.tool) return false;
  return true;
}

export function entriesEqual(a: AllowlistEntry, b: AllowlistEntry): boolean {
  return a.scope === b.scope && a.tool === b.tool && a.grain === b.grain && a.key === b.key;
}
