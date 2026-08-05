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

  // agentStore hydrates the persisted allowlist via
  // `allowlist.filter(isWellFormedEntry)` (agentStore.ts) — a stored grant
  // that fails this check is silently dropped, not thrown or crashed on. A
  // grant whose key carries a control or format character (invisible,
  // reordering, or collapsing when rendered as a revocable row in Settings)
  // must be dropped the same way a legacy-shaped entry is: fail closed by
  // disappearing, not by resurrecting as an unreviewable grant.
  it.each([
    ["C0 control", "df -h\x1b"],
    ["DEL", "df -h\x7f"],
    ["bidi override", "df\u202e -h"],
    ["zero-width", "df\u200b -h"],
  ])("rejects a key carrying a %s character, so it is dropped on hydrate", (_label, key) => {
    expect(isWellFormedEntry({ ...ok, key })).toBe(false);
  });

  // Demonstrates the actual hydrate outcome, not just the predicate: a mixed
  // persisted array survives `.filter(isWellFormedEntry)` (agentStore.ts) by
  // losing exactly the malformed entry — no throw, no crash, the well-formed
  // neighbors on either side are unaffected.
  it("a stored array with one control-character entry drops only that entry on hydrate, without throwing", () => {
    const stored: unknown[] = [ok, { ...ok, key: "df -h\x1b" }, { ...ok, key: "uptime" }];
    expect(() => stored.filter(isWellFormedEntry)).not.toThrow();
    expect(stored.filter(isWellFormedEntry)).toEqual([ok, { ...ok, key: "uptime" }]);
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

describe("path tools may only be allowlisted at the exact grain", () => {
  it.each(["make_dir", "write_file", "delete_path"])(
    "%s is keyed on its exact path, never tool-grain", (tool) => {
      const [entry, ...rest] = allowlistCandidates(tool, { target: "c1", path: "/srv/a.txt" }, "c1");
      expect(rest).toEqual([]);
      expect(entry).toMatchObject({ grain: "exact", tool, key: "/srv/a.txt" });
    },
  );

  it("rename_path is keyed on both ends, so a grant cannot be replayed on a different move", () => {
    const [entry] = allowlistCandidates("rename_path", { target: "c1", from: "/a", to: "/b" }, "c1");
    expect(entry).toMatchObject({ grain: "exact", key: "/a → /b" });
  });

  it("transfer_file is keyed on both endpoints including their targets", () => {
    const [entry] = allowlistCandidates(
      "transfer_file",
      { fromTarget: "c1", fromPath: "/a", toTarget: "local", toPath: "/b" },
      "c1",
    );
    expect(entry).toMatchObject({ grain: "exact", key: "c1 → /a → local → /b" });
  });

  it("refuses to allowlist a path carrying a bidi or zero-width character", () => {
    expect(allowlistCandidates("delete_path", { target: "c1", path: "/srv/a‮txt.exe" }, "c1")).toEqual([]);
  });

  it("refuses to allowlist a call with a missing path rather than keying on nothing", () => {
    expect(allowlistCandidates("delete_path", { target: "c1" }, "c1")).toEqual([]);
  });

  // The whole point: a tool-grain grant would authorise deleting ANY path there.
  it("rejects a persisted tool-grain entry for a path tool on hydrate", () => {
    expect(isWellFormedEntry({ scope: "c1", tool: "delete_path", grain: "tool", key: "delete_path" })).toBe(false);
    expect(isWellFormedEntry({ scope: "c1", tool: "delete_path", grain: "exact", key: "/srv/a.txt" })).toBe(true);
  });

  it("still gives read-only file tools a tool-grain entry", () => {
    const [entry] = allowlistCandidates("list_files", { target: "c1", path: "/srv" }, "c1");
    expect(entry).toMatchObject({ grain: "tool", tool: "list_files" });
  });
});
