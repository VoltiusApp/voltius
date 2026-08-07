export { FILE_TOOLS, deriveScope } from "@voltius/tools";

// `!` is included because interactive bash/zsh perform history expansion on
// it (e.g. `df -h !sudo`, `df !!`, `df !-1` expand to prior history entries
// before the shell ever consults the tool's own argument list) — a command
// that reads as an innocuous allowlisted invocation can execute something
// else entirely once the interactive PTY expands it.
//
// Also included: C0 controls (\x00-\x1F, which includes CR/LF above but also
// TAB, ESC, etc.), DEL (\x7F), C1 controls (\x80-\x9F), Unicode bidi marks
// and embedding overrides (U+200E-U+200F, U+202A-U+202E), bidi isolates
// (U+2066-U+2069), and zero-width characters (U+200B-U+200D, U+FEFF). None of
// these are shell syntax, but a pre-authorization is only sound if the text
// the user reviewed IS the text that executes — a bidi override renders the
// command as a permutation of the real byte sequence, a zero-width character
// is invisible in the rendered text while still present in what runs, and a
// control character can render as nothing (or collapse whitespace) while
// still reaching the shell. Any of these makes the rendered form diverge from
// the executed form without ever tripping a shell-syntax character, which is
// exactly the gap this predicate exists to close.
const SHELL_METACHARACTERS =
  /[;&|`$()<>\\!\r\n\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

/** Any tool whose arguments include a shell command string. Any new tool
 * that takes a shell command MUST be added here, or `isAllowlistable` will
 * default to treating it as safe to allowlist regardless of its content. */
export const COMMAND_CARRYING_TOOLS = new Set(["run_command"]);

export const PATH_CARRYING_TOOLS = new Set([
  "make_dir",
  "rename_path",
  "delete_path",
  "write_file",
  "transfer_file",
]);

/** True for a tool that may only ever be allowlisted at the exact-args grain. */
export function isExactGrainTool(tool: string): boolean {
  return COMMAND_CARRYING_TOOLS.has(tool) || PATH_CARRYING_TOOLS.has(tool);
}

/**
 * The exact-grain allowlist key for a path tool: every path the call touches,
 * so a grant cannot be replayed against a different one. Empty when the call
 * carries no usable path, which makes it un-allowlistable (fail closed).
 */
export function pathGrainKey(tool: string, args: Record<string, unknown>): string {
  const part = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const parts =
    tool === "rename_path"
      ? [part(args.from), part(args.to)]
      : tool === "transfer_file"
        ? [part(args.fromTarget), part(args.fromPath), part(args.toTarget), part(args.toPath)]
        : [part(args.path)];
  if (parts.some((x) => x === "")) return "";
  return parts.join(" → ");
}

/** True if `s` contains a shell metacharacter that could change how a
 * command behaves outside of the exact approved invocation. Shared by
 * `isAllowlistable` and the allowlist store's own write-time guard so the
 * two checks can't drift apart. */
export function hasShellMetacharacter(s: string): boolean {
  return SHELL_METACHARACTERS.test(s);
}

export function isAllowlistable(tool: string, args: Record<string, unknown>): boolean {
  if (PATH_CARRYING_TOOLS.has(tool)) {
    const key = pathGrainKey(tool, args);
    // Same rule as a command, for the same reason: a pre-authorisation is only
    // sound if the text the user reviewed IS the text that acts. A bidi or
    // zero-width character makes a rendered path diverge from the real one.
    // It also means a Windows path (backslashes) can never be allowlisted —
    // deliberately failing closed rather than approximating.
    return key !== "" && !hasShellMetacharacter(key);
  }
  if (!COMMAND_CARRYING_TOOLS.has(tool)) return true;
  const cmd = String(args.command ?? "");
  return !hasShellMetacharacter(cmd);
}

/** Display sentinel used on a `PendingApproval` when `deriveScope` could not
 * resolve a connection. A collision with a real connection id could only
 * mislabel a card, never authorize anything: `approvalController.ts` never
 * lets this value reach `allowlistCandidates`. */
export const UNKNOWN_SCOPE = "unknown connection";
