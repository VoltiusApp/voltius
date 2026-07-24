import { describe, it, expect, vi } from "vitest";
import { deriveHost, allowlistKey, isAllowlistable } from "./hostDerivation";

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
});

describe("deriveHost", () => {
  it("open_session: connectionId → host", async () => {
    expect(await deriveHost(api(), "open_session", { connectionId: "c1" })).toBe("web-01");
  });
  it("run_command: sessionId → connectionId → host", async () => {
    expect(await deriveHost(api(), "run_command", { sessionId: "s1", command: "ls" })).toBe("web-01");
  });
  it("falls back to 'local' when unresolved", async () => {
    expect(await deriveHost(api(), "run_command", { sessionId: "nope", command: "ls" })).toBe("local");
  });
});
