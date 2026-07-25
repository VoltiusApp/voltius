import { describe, it, expect } from "vitest";
import {
  allowlistCandidates,
  entriesEqual,
  isWellFormedEntry,
  normalizeCommand,
  type AllowlistEntry,
} from "./allowlist";

const SCOPE = "c1";

describe("normalizeCommand", () => {
  it("trims the ends", () => {
    expect(normalizeCommand("  df -h  ")).toBe("df -h");
  });

  // Collapsing internal runs would make `grep 'a  b' f` match a grant given for
  // `grep 'a b' f` — a genuinely different command, because the arg is quoted.
  it("preserves internal whitespace", () => {
    expect(normalizeCommand("grep 'a  b' f")).toBe("grep 'a  b' f");
  });
});

describe("allowlistCandidates — non-command tools", () => {
  it("yields a single tool-grain candidate", () => {
    expect(allowlistCandidates("open_session", { connectionId: "c1" }, SCOPE)).toEqual([
      { scope: SCOPE, tool: "open_session", grain: "tool", key: "open_session" },
    ]);
  });
});

describe("allowlistCandidates — run_command", () => {
  it.each([
    "cat /etc/passwd",
    "df -h",
    "ss -K dst 10.0.0.1",
    "mybin --x",
    "sudo -l",
    "ssh other-host uptime",
    "find / -name x",
    "env",
    "xargs echo",
    "python -c 1",
    "docker ps",
    "journalctl -u ssh",
  ])("yields exactly one exact-grain candidate for %s, never a broader one", (command) => {
    expect(allowlistCandidates("run_command", { command }, SCOPE)).toEqual([
      { scope: SCOPE, tool: "run_command", grain: "exact", key: command },
    ]);
  });

  it("yields nothing when the command carries a shell metacharacter", () => {
    expect(allowlistCandidates("run_command", { command: "df -h | grep /" }, SCOPE)).toEqual([]);
    expect(allowlistCandidates("run_command", { command: "df -h !sudo" }, SCOPE)).toEqual([]);
  });

  it("yields nothing for an empty command", () => {
    expect(allowlistCandidates("run_command", { command: "   " }, SCOPE)).toEqual([]);
  });

  it("keys exact on the trimmed command, so a different argv does not match", () => {
    const [exact] = allowlistCandidates("run_command", { command: " df -h " }, SCOPE);
    expect(exact.key).toBe("df -h");
    const other = allowlistCandidates("run_command", { command: "df --output=source" }, SCOPE);
    expect(other.some((c) => entriesEqual(c, exact))).toBe(false);
  });
});

describe("isWellFormedEntry", () => {
  const ok: AllowlistEntry = { scope: SCOPE, tool: "run_command", grain: "exact", key: "df -h" };

  it("accepts a well-formed entry", () => {
    expect(isWellFormedEntry(ok)).toBe(true);
  });

  // Legacy 3a entries were {host, key} first-token prefixes. Reading them
  // forward as prefix grants would resurrect the vulnerability being closed.
  it("rejects a legacy {host, key} entry", () => {
    expect(isWellFormedEntry({ host: SCOPE, key: "df" })).toBe(false);
  });

  it("rejects 3b-era host-keyed entries so they are dropped on hydrate", () => {
    expect(isWellFormedEntry({ host: "ssh-host-1", tool: "run_command", grain: "exact", key: "df -h" })).toBe(false);
  });

  it("accepts a connection-scoped entry", () => {
    expect(isWellFormedEntry({ scope: "c1", tool: "run_command", grain: "exact", key: "df -h" })).toBe(true);
  });

  it.each([null, undefined, 42, "df", [], { ...ok, grain: "wat" }, { ...ok, scope: "" }, { ...ok, key: "" }, { ...ok, tool: "" }])(
    "rejects malformed %s",
    (value) => {
      expect(isWellFormedEntry(value)).toBe(false);
    },
  );

  // The cross-check: grain must agree with whether the tool is command-carrying.
  // These are shapes allowlistCandidates could never produce, so they must not
  // survive hydrate either.
  it("rejects a tool-grain entry for a command-carrying tool", () => {
    expect(isWellFormedEntry({ scope: SCOPE, tool: "run_command", grain: "tool", key: "run_command" })).toBe(false);
  });

  it("rejects an exact-grain entry for a non-command-carrying tool", () => {
    expect(isWellFormedEntry({ scope: SCOPE, tool: "open_session", grain: "exact", key: "open_session" })).toBe(false);
  });

  it("rejects any key carrying a shell metacharacter", () => {
    expect(isWellFormedEntry({ ...ok, key: "df -h | sh" })).toBe(false);
  });

  // A tool-grain grant must authorize the whole tool, keyed by its own name —
  // allowlistCandidates never emits key !== tool for grain "tool". A
  // hand-edited entry with a mismatched key must not survive hydrate either,
  // or it would render as a revocable row for a grant that was never issued.
  it("rejects a tool-grain entry whose key does not match its tool", () => {
    expect(
      isWellFormedEntry({ scope: SCOPE, tool: "open_session", grain: "tool", key: "anything" }),
    ).toBe(false);
  });
});

describe("entriesEqual", () => {
  // Two connections to the same host must never share a grant bucket — a
  // scope mismatch alone must fail the comparison, even with everything else identical.
  it("does not equate identical grants on different connections", () => {
    expect(
      entriesEqual(
        { scope: "c1", tool: "run_command", grain: "exact", key: "df -h" },
        { scope: "c2", tool: "run_command", grain: "exact", key: "df -h" },
      ),
    ).toBe(false);
  });
});
