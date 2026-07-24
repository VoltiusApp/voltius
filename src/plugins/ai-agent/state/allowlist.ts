import { COMMAND_CARRYING_TOOLS, hasShellMetacharacter, isAllowlistable } from "./hostDerivation";

/**
 * How broadly a remembered approval applies.
 *
 * - `tool`   — the whole tool on a host (`open_session` on `ssh-host-1`).
 * - `exact`  — one exact command line, and nothing else.
 * - `prefix` — a binary and ANY arguments. Deliberately opt-in, and only ever
 *   offered for {@link PREFIX_GRANTABLE_BINARIES}.
 */
export type AllowlistGrain = "tool" | "exact" | "prefix";

export interface AllowlistEntry {
  host: string;
  tool: string;
  grain: AllowlistGrain;
  /** Tool name (`tool`), full trimmed command (`exact`), or binary (`prefix`). */
  key: string;
}

/**
 * The ONLY binaries that may take a coarse "any arguments" grant.
 *
 * This is a POSITIVE list, not a denylist of exec-capable binaries, and the
 * distinction is the whole point: a denylist fails OPEN on anything its author
 * did not think of — a new tool, a site-local wrapper script — while this fails
 * CLOSED. An unknown binary is exact-only, always.
 *
 * Membership rule: not exec-capable, not primarily a reader of arbitrary file
 * CONTENTS (which would be an exfiltration path to the model provider), and a
 * genuine READ-ONLY system-state diagnostic. That excludes `cat`/`ls`/`grep`/
 * `head`/`tail`/`find`/`stat`/`file` on the contents rule; `sudo`/`ssh`/`env`/
 * `xargs`/`docker`/`kubectl`/`systemctl`/`journalctl`/`git`/`awk`/`python`/
 * `make`/`nc`/`tar`/`rsync`/`vim`/`ip` (its `netns exec <ns> <cmd>` subcommand
 * runs arbitrary commands) on the exec rule; and `ifconfig`/`route`/`arp`
 * (mutate live network state — can sever connectivity or redirect traffic),
 * `date` (`-s` sets the clock, `-f FILE` reads an arbitrary file), and
 * `hostname` (renames the host) on the state-mutation rule.
 */
export const PREFIX_GRANTABLE_BINARIES: ReadonlySet<string> = new Set([
  "arch", "df", "dmesg", "du", "free", "id", "iostat", "lsblk", "lscpu",
  "lsmem", "lspci", "lsusb", "mpstat", "netstat", "nproc", "ps", "pstree",
  "ss", "uname", "uptime", "vmstat", "w", "who", "whoami",
]);

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
 * Returns `[]` when nothing may be granted, which is also the fail-closed
 * answer for a command carrying a shell metacharacter.
 */
export function allowlistCandidates(
  tool: string,
  args: Record<string, unknown>,
  host: string,
): AllowlistEntry[] {
  if (!isAllowlistable(tool, args)) return [];
  if (!COMMAND_CARRYING_TOOLS.has(tool)) {
    return [{ host, tool, grain: "tool", key: tool }];
  }
  const command = normalizeCommand(String(args.command ?? ""));
  if (!command) return [];
  const candidates: AllowlistEntry[] = [{ host, tool, grain: "exact", key: command }];
  const binary = command.split(/\s+/)[0];
  if (PREFIX_GRANTABLE_BINARIES.has(binary)) {
    candidates.push({ host, tool, grain: "prefix", key: binary });
  }
  return candidates;
}

/**
 * Validates a persisted entry. Applied on hydrate, so 3a's legacy
 * `{host, key}` entries (which were first-token PREFIXES) are discarded rather
 * than read forward as prefix grants — that would resurrect exactly the hole
 * this slice closes. Re-checking the positive list also means shrinking
 * PREFIX_GRANTABLE_BINARIES later self-heals grants already on disk.
 */
export function isWellFormedEntry(value: unknown): value is AllowlistEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (typeof e.host !== "string" || e.host.length === 0) return false;
  if (typeof e.tool !== "string" || e.tool.length === 0) return false;
  if (typeof e.key !== "string" || e.key.length === 0) return false;
  if (e.grain !== "tool" && e.grain !== "exact" && e.grain !== "prefix") return false;
  if (hasShellMetacharacter(e.key)) return false;
  if (e.grain === "prefix" && !PREFIX_GRANTABLE_BINARIES.has(e.key)) return false;
  return true;
}

export function entriesEqual(a: AllowlistEntry, b: AllowlistEntry): boolean {
  return a.host === b.host && a.tool === b.tool && a.grain === b.grain && a.key === b.key;
}
