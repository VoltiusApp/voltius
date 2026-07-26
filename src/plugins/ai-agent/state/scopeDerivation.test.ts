import { describe, it, expect } from "vitest";
import { deriveScope, isAllowlistable, hasShellMetacharacter, COMMAND_CARRYING_TOOLS } from "./scopeDerivation";

describe("isAllowlistable", () => {
  const metacharacters = [";", "&", "|", "`", "$", "(", ")", "<", ">", "\\", "\n", "\r"];
  for (const ch of metacharacters) {
    it(`rejects run_command containing ${JSON.stringify(ch)}`, () => {
      expect(isAllowlistable("run_command", { command: `df -h ${ch} rm -rf ~` })).toBe(false);
    });
  }

  it("allows a plain command with flags", () => {
    expect(isAllowlistable("run_command", { command: "df -h" })).toBe(true);
  });
  it("allows a command with a path", () => {
    expect(isAllowlistable("run_command", { command: "cat /var/log/syslog" })).toBe(true);
  });
  it("allows a command with a glob", () => {
    expect(isAllowlistable("run_command", { command: "ls *.txt" })).toBe(true);
  });
  it("allows a command with a question-mark glob", () => {
    expect(isAllowlistable("run_command", { command: "ls file?.txt" })).toBe(true);
  });
  it("allows a command with quotes", () => {
    expect(isAllowlistable("run_command", { command: `echo "hello world"` })).toBe(true);
  });
  it("allows a command with a tilde", () => {
    expect(isAllowlistable("run_command", { command: "ls ~/projects" })).toBe(true);
  });
  it("allows a command with an equals sign", () => {
    expect(isAllowlistable("run_command", { command: "FOO=bar env" })).toBe(true);
  });
  it("non-run_command tools are always allowlistable", () => {
    expect(isAllowlistable("open_session", { connectionId: "c1" })).toBe(true);
  });

  // `!` triggers bash/zsh interactive history expansion, letting a grant for
  // e.g. `df` silently re-run an unrelated prior command (see scopeDerivation.ts
  // comment on SHELL_METACHARACTERS).
  it("rejects run_command with a history-expansion bang-arg (df -h !sudo)", () => {
    expect(isAllowlistable("run_command", { command: "df -h !sudo" })).toBe(false);
  });
  it("rejects run_command with bang-bang history expansion (df !!)", () => {
    expect(isAllowlistable("run_command", { command: "df !!" })).toBe(false);
  });
  it("rejects run_command with a relative history-expansion arg (df !-1)", () => {
    expect(isAllowlistable("run_command", { command: "df !-1" })).toBe(false);
  });

  describe("edge-case args.command shapes", () => {
    it("args.command absent entirely is allowlistable (coerces to empty string, no metacharacter)", () => {
      expect(isAllowlistable("run_command", {})).toBe(true);
    });
    it("command present but not a string is allowlistable (String() coercion finds no metacharacter)", () => {
      expect(isAllowlistable("run_command", { command: 42 as unknown as string })).toBe(true);
    });
    it("empty string command is allowlistable", () => {
      expect(isAllowlistable("run_command", { command: "" })).toBe(true);
    });
    it("whitespace-only command is allowlistable", () => {
      expect(isAllowlistable("run_command", { command: "   " })).toBe(true);
    });
  });
});

describe("hasShellMetacharacter", () => {
  it("matches the same metacharacters isAllowlistable rejects", () => {
    expect(hasShellMetacharacter("rm -rf ; echo hi")).toBe(true);
    expect(hasShellMetacharacter("df -h !sudo")).toBe(true);
  });
  it("is false for a plain token", () => {
    expect(hasShellMetacharacter("apt-get")).toBe(false);
  });
});

// A command carrying one of these renders differently (permuted, invisible,
// or collapsed) from what the shell actually receives, even though it
// contains none of the shell-syntax characters above — the exact gap
// Important #1 of the task-6 review closes. One representative codepoint per
// class, plus tab called out on its own since whitespace collapse is its own
// failure mode.
describe("hasShellMetacharacter — control and format characters", () => {
  const classes: [string, string][] = [
    ["C0 control (NUL)", "\x00"],
    ["C0 control (ESC)", "\x1b"],
    ["tab", "\t"],
    ["DEL", "\x7f"],
    ["C1 control", "\x9b"],
    ["bidi mark (LRM)", "\u200e"],
    ["bidi mark (RLM)", "\u200f"],
    ["bidi override (LRO)", "\u202d"],
    ["bidi override (RLO)", "\u202e"],
    ["bidi isolate (LRI)", "\u2066"],
    ["bidi isolate (PDI)", "\u2069"],
    ["zero-width (ZWSP)", "\u200b"],
    ["zero-width (ZWJ)", "\u200d"],
    ["zero-width (BOM)", "\ufeff"],
  ];
  for (const [label, ch] of classes) {
    it(`hasShellMetacharacter is true for a ${label} character`, () => {
      expect(hasShellMetacharacter(`echo ${ch}hi`)).toBe(true);
    });
    it(`isAllowlistable is false for run_command carrying a ${label} character`, () => {
      expect(isAllowlistable("run_command", { command: `echo ${ch}hi` })).toBe(false);
    });
  }
});

describe("COMMAND_CARRYING_TOOLS", () => {
  it("contains run_command", () => {
    expect(COMMAND_CARRYING_TOOLS.has("run_command")).toBe(true);
  });
  it("does not contain unrelated tools", () => {
    expect(COMMAND_CARRYING_TOOLS.has("open_session")).toBe(false);
  });
});

describe("deriveScope", () => {
  const CONNS = [
    { id: "c1", name: "Prod DB", host: "web-01", port: 22, username: "deploy", auth_type: "key", tags: [] },
    { id: "c2", name: "Prod root", host: "web-01", port: 22, username: "root", auth_type: "key", tags: [] },
  ];
  const api = (over: Partial<{ sessions: unknown; connections: unknown }> = {}) => ({
    sessions: { list: () => [{ id: "s1", connectionId: "c1", connectionName: "Prod DB", status: "connected", type: "ssh" }] },
    connections: { list: async () => CONNS },
    ...over,
  }) as never;

  it("open_session resolves to the connection id", async () => {
    expect(await deriveScope(api(), "open_session", { connectionId: "c1" })).toBe("c1");
  });

  it("run_command resolves via the session's connectionId", async () => {
    expect(await deriveScope(api(), "run_command", { sessionId: "s1", command: "ls" })).toBe("c1");
  });

  it("two connections to the same host get DIFFERENT scopes", async () => {
    expect(await deriveScope(api(), "open_session", { connectionId: "c1" })).toBe("c1");
    expect(await deriveScope(api(), "open_session", { connectionId: "c2" })).toBe("c2");
  });

  it("returns null for an unknown session", async () => {
    expect(await deriveScope(api(), "run_command", { sessionId: "nope", command: "ls" })).toBeNull();
  });

  it("returns null when open_session carries a connectionId that does not exist", async () => {
    expect(await deriveScope(api(), "open_session", { connectionId: "forged" })).toBeNull();
  });

  it("returns null when run_command's session names a connection that no longer exists", async () => {
    const a = api({
      sessions: { list: () => [{ id: "s1", connectionId: "deleted", connectionName: "Gone", status: "connected", type: "ssh" }] },
    });
    expect(await deriveScope(a, "run_command", { sessionId: "s1", command: "ls" })).toBeNull();
  });

  it("returns null when connectionId is missing", async () => {
    expect(await deriveScope(api(), "open_session", {})).toBeNull();
  });

  it("returns 'local' for a genuine local session", async () => {
    const a = api({ sessions: { list: () => [{ id: "s1", connectionId: "local", connectionName: "Local", status: "connected", type: "local" }] } });
    expect(await deriveScope(a, "run_command", { sessionId: "s1", command: "ls" })).toBe("local");
  });

  it("returns null when the connections lookup throws", async () => {
    const a = api({ connections: { list: async () => { throw new Error("boom"); } } });
    expect(await deriveScope(a, "open_session", { connectionId: "c1" })).toBeNull();
  });
});
