import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { McpMark, mcpOwnerTitle, mcpTint } from "./McpMark";

// vitest.config.ts sets no `globals: true`, so testing-library's automatic
// cleanup never registers; unmount explicitly between tests.
afterEach(() => cleanup());

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts?.client ? `${key}:${String(opts.client)}` : key) as never;
const keys = {
  known: "panes.header.mcpTooltip",
  unknown: "panes.header.mcpTooltipUnknown",
  disconnected: "panes.header.mcpTooltipDisconnected",
};

describe("mcpOwnerTitle", () => {
  it("is undefined with no owner", () => {
    expect(mcpOwnerTitle(undefined, t, keys)).toBeUndefined();
  });

  it("names the client when one reported a name", () => {
    expect(mcpOwnerTitle({ clientId: "c", clientName: "Claude Code", since: 0 }, t, keys))
      .toBe("panes.header.mcpTooltip:Claude Code");
  });

  it("falls back to the anonymous string on an empty name", () => {
    expect(mcpOwnerTitle({ clientId: "c", clientName: "", since: 0 }, t, keys))
      .toBe("panes.header.mcpTooltipUnknown");
  });

  it("picks the disconnected wording for an orphan", () => {
    expect(mcpOwnerTitle({ clientId: null, clientName: "Claude Code", since: 0 }, t, keys))
      .toBe("panes.header.mcpTooltipDisconnected:Claude Code");
  });

  it("falls back to the unknown wording when an orphan has no name", () => {
    expect(mcpOwnerTitle({ clientId: null, clientName: "", since: 0 }, t, keys))
      .toBe("panes.header.mcpTooltipUnknown");
  });
});

describe("McpMark rail", () => {
  it("carries the caller's testId and no pulse when idle", () => {
    render(<McpMark variant="rail" testId="mcp-bar-tab-1" busy={false} />);
    const el = screen.getByTestId("mcp-bar-tab-1");
    expect(el.className).not.toContain("mcp-pulse");
  });

  it("pulses while busy", () => {
    render(<McpMark variant="rail" testId="mcp-bar-tab-1" busy />);
    expect(screen.getByTestId("mcp-bar-tab-1").className).toContain("mcp-pulse");
  });

  it("never pulses while disconnected, even if busy", () => {
    render(<McpMark variant="rail" testId="mcp-bar-tab-1" busy disconnected />);
    expect(screen.getByTestId("mcp-bar-tab-1").className).not.toContain("mcp-pulse");
  });
});

describe("McpMark chip", () => {
  it("renders under the stable mcp-chip testId with its title", () => {
    render(<McpMark variant="chip" title="Opened by Claude Code" label="MCP" />);
    // @testing-library/jest-dom is NOT installed in this repo; assert via getAttribute.
    expect(screen.getByTestId("mcp-chip").getAttribute("title")).toBe("Opened by Claude Code");
  });
});

describe("mcpTint", () => {
  it("mixes the mcp token over the given base", () => {
    expect(mcpTint("var(--t-bg-card)")).toBe("color-mix(in srgb, var(--t-mcp) 10%, var(--t-bg-card))");
  });
});
