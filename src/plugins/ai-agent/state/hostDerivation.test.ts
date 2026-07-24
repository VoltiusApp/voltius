import { describe, it, expect, vi } from "vitest";
import { deriveHost, allowlistKey, isAllowlistable, hasShellMetacharacter, COMMAND_CARRYING_TOOLS } from "./hostDerivation";

function api(overrides: Record<string, unknown> = {}) {
  return {
    connections: { list: vi.fn(async () => [{ id: "c1", name: "Web", host: "web-01" }]) },
    sessions: { list: vi.fn(() => [{ id: "s1", connectionId: "c1" }]) },
    ...overrides,
  } as never;
}

describe("allowlistKey", () => {
  it("uses first command token for run_command", () => {
    expect(allowlistKey("run_command", { command: "apt-get update" })).toBe("apt-get");
  });
  it("uses tool name otherwise", () => {
    expect(allowlistKey("open_session", { connectionId: "c1" })).toBe("open_session");
  });
});

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
  // e.g. `df` silently re-run an unrelated prior command (see hostDerivation.ts
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

describe("COMMAND_CARRYING_TOOLS", () => {
  it("contains run_command", () => {
    expect(COMMAND_CARRYING_TOOLS.has("run_command")).toBe(true);
  });
  it("does not contain unrelated tools", () => {
    expect(COMMAND_CARRYING_TOOLS.has("open_session")).toBe(false);
  });
});

describe("deriveHost", () => {
  it("open_session: connectionId → host", async () => {
    expect(await deriveHost(api(), "open_session", { connectionId: "c1" })).toBe("web-01");
  });
  it("run_command: sessionId → connectionId → host", async () => {
    expect(await deriveHost(api(), "run_command", { sessionId: "s1", command: "ls" })).toBe("web-01");
  });
  it("returns null (not 'local') when the session can't be found — fail closed, not open", async () => {
    expect(await deriveHost(api(), "run_command", { sessionId: "nope", command: "ls" })).toBeNull();
  });
  it("returns null (not 'local') when the connectionId doesn't match any known connection", async () => {
    const a = api({ sessions: { list: vi.fn(() => [{ id: "s1", connectionId: "deleted-conn" }]) } });
    expect(await deriveHost(a, "run_command", { sessionId: "s1", command: "ls" })).toBeNull();
  });
  it("returns null (not 'local') for open_session with no connectionId", async () => {
    expect(await deriveHost(api(), "open_session", {})).toBeNull();
  });
  it("still resolves 'local' for a genuine local-shell session (connectionId literally \"local\")", async () => {
    const a = api({ sessions: { list: vi.fn(() => [{ id: "s1", connectionId: "local" }]) } });
    expect(await deriveHost(a, "run_command", { sessionId: "s1", command: "ls" })).toBe("local");
  });
  // Minor A: serial connections are created with `host: ""`. `?? null` only
  // falls back on null/undefined, so an empty string used to sail through as
  // a "resolved" host, collapsing every serial connection into one shared
  // allowlist bucket `{ host: "", key }`. Must fail closed like any other
  // unresolvable host.
  it("returns null (not '') for a connection with an empty-string host — fail closed, not a shared bucket", async () => {
    const a = api({ connections: { list: vi.fn(async () => [{ id: "c1", name: "Serial", host: "" }]) } });
    expect(await deriveHost(a, "open_session", { connectionId: "c1" })).toBeNull();
  });
});
