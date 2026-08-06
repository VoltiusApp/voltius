import { describe, it, expect } from "vitest";
import { summarizeTool } from "./toolSummary";

const items = (n: number) => `${n} items`;

describe("summarizeTool", () => {
  it("summarizes a command call as target · command", () => {
    expect(summarizeTool("call", JSON.stringify({ sessionId: "s1", command: "uname -a" }), items))
      .toBe("s1 · uname -a");
    expect(summarizeTool("call", JSON.stringify({ command: "uptime" }), items)).toBe("uptime");
  });

  it("summarizes a transfer as both endpoints", () => {
    const args = { fromTarget: "c1", fromPath: "/a", toTarget: "local", toPath: "/b" };
    expect(summarizeTool("call", JSON.stringify(args), items)).toBe("c1:/a → local:/b");
  });

  it("summarizes a path call and a bare target call", () => {
    expect(summarizeTool("call", JSON.stringify({ target: "c1", path: "/etc" }), items)).toBe("c1:/etc");
    expect(summarizeTool("call", JSON.stringify({ connectionId: "c1" }), items)).toBe("c1");
  });

  it("counts array results and reads an exit code", () => {
    expect(summarizeTool("result", JSON.stringify([1, 2, 3]), items)).toBe("3 items");
    expect(summarizeTool("result", JSON.stringify({ output: "ok\nmore", exitCode: 0 }), items))
      .toBe("exit 0 · ok");
  });

  it("returns an error's message untouched", () => {
    expect(summarizeTool("error", "no such file", items)).toBe("no such file");
  });

  it("falls back to the raw detail for anything unparseable", () => {
    expect(summarizeTool("result", "not json", items)).toBe("not json");
    expect(summarizeTool("call", "", items)).toBe("");
  });

  it("keeps every key when no shape matches, so nothing is silently hidden", () => {
    expect(summarizeTool("call", JSON.stringify({ lines: 20, follow: true }), items))
      .toBe("lines: 20 · follow: true");
  });

  it("counts a nested array instead of rendering [object Object]", () => {
    const detail = JSON.stringify({ steps: [{ tool: "run_command" }, { tool: "close_session" }] });
    expect(summarizeTool("call", detail, items)).toBe("steps: 2");
  });
});
