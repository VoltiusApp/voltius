import { describe, it, expect, vi } from "vitest";
import { buildTerminalContext, formatContextBlock, MAX_CONTEXT_LINES, MAX_CONTEXT_CHARS } from "./touchpoint";

const api = (selection: string, snapshot: string) =>
  ({ terminal: { readSelection: vi.fn(() => selection), readSnapshot: vi.fn(() => snapshot) } }) as never;

describe("buildTerminalContext", () => {
  it("prefers a non-empty selection", () => {
    const ctx = buildTerminalContext(api("boom\nfailed", "whole buffer"), "s1", "Prod DB");
    expect(ctx).toMatchObject({ source: "selection", text: "boom\nfailed", lineCount: 2, truncated: false, connectionName: "Prod DB", sessionId: "s1" });
  });

  it("falls back to the snapshot for a whitespace-only selection", () => {
    expect(buildTerminalContext(api("   \n  ", "line a\nline b"), "s1", "Prod DB")).toMatchObject({
      source: "snapshot", lineCount: 2,
    });
  });

  it("returns null when neither yields anything", () => {
    expect(buildTerminalContext(api("", ""), "s1", "Prod DB")).toBeNull();
  });

  it("caps by line count and flags truncation, keeping the LAST lines", () => {
    const many = Array.from({ length: MAX_CONTEXT_LINES + 20 }, (_, i) => `l${i}`).join("\n");
    const ctx = buildTerminalContext(api(many, ""), "s1", "Prod DB");
    expect(ctx?.truncated).toBe(true);
    expect(ctx?.lineCount).toBe(MAX_CONTEXT_LINES);
    expect(ctx?.text.split("\n")[0]).toBe("l20");
  });

  it("caps by characters", () => {
    const ctx = buildTerminalContext(api("x".repeat(MAX_CONTEXT_CHARS + 500), ""), "s1", "Prod DB");
    expect(ctx?.truncated).toBe(true);
    expect(ctx!.text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  it("requests a 200-line snapshot", () => {
    const a = api("", "x");
    buildTerminalContext(a, "s1", "Prod DB");
    expect((a as unknown as { terminal: { readSnapshot: ReturnType<typeof vi.fn> } }).terminal.readSnapshot)
      .toHaveBeenCalledWith("s1", 200);
  });

  it("returns null instead of throwing when the gated read throws", () => {
    const a = { terminal: { readSelection: () => { throw new Error("denied"); }, readSnapshot: () => "" } } as never;
    expect(buildTerminalContext(a, "s1", "Prod DB")).toBeNull();
  });
});

describe("formatContextBlock", () => {
  it("labels the source, the connection, and the line count in a fenced block", () => {
    const block = formatContextBlock({
      sessionId: "s1", connectionName: "Prod DB", source: "selection", text: "boom", lineCount: 1, truncated: false,
    });
    expect(block).toContain("Attached from Prod DB (terminal selection, 1 lines)");
    expect(block).toContain("```\nboom\n```");
  });

  it("says so when the attachment was truncated", () => {
    const block = formatContextBlock({
      sessionId: "s1", connectionName: "Prod DB", source: "snapshot", text: "x", lineCount: 1, truncated: true,
    });
    expect(block).toContain("truncated");
  });
});
