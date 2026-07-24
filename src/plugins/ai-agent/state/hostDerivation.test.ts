import { describe, it, expect, vi } from "vitest";
import { deriveHost, allowlistKey } from "./hostDerivation";

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
