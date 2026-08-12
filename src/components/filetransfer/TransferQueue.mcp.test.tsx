import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransferQueue } from "./TransferQueue";
import type { Transfer } from "./SFTPTypes";

// vitest.config.ts sets no `globals: true`, so testing-library's automatic
// cleanup never registers; unmount explicitly between tests.
afterEach(() => cleanup());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.client ? `${key}:${String(opts.client)}` : key,
  }),
}));

const base: Transfer = {
  id: "t-1", label: "a.txt", direction: "→", transferred: 0, total: 100, status: "running",
};

const renderQueue = (transfers: Transfer[], onRetry = vi.fn()) => {
  render(
    <TransferQueue
      transfers={transfers}
      onClear={vi.fn()}
      onCancel={vi.fn()}
      onCancelAll={vi.fn()}
      onRetry={onRetry}
    />,
  );
  return onRetry;
};

describe("MCP-owned transfer rows", () => {
  it("shows no rail for a user-started transfer", () => {
    renderQueue([base]);
    expect(screen.queryByTestId("mcp-bar-t-1")).toBeNull();
  });

  it("rails and names the client for an MCP-started transfer", () => {
    renderQueue([{ ...base, owner: { clientId: "c-1", clientName: "Claude Code", since: 1 } }]);
    expect(screen.getByTestId("mcp-bar-t-1")).toBeTruthy();
    expect(screen.getByTitle("fileTransfer.queue.mcpTooltip:Claude Code")).toBeTruthy();
  });

  it("pulses the rail only while the transfer runs", () => {
    const owner = { clientId: "c-1", clientName: "Claude Code", since: 1 };
    renderQueue([{ ...base, owner }, { ...base, id: "t-2", status: "done", owner }]);
    expect(screen.getByTestId("mcp-bar-t-1").className).toContain("mcp-pulse");
    expect(screen.getByTestId("mcp-bar-t-2").className).not.toContain("mcp-pulse");
  });
});

describe("retry button", () => {
  it("is absent while running and when done", () => {
    renderQueue([base, { ...base, id: "t-2", status: "done" }]);
    expect(screen.queryByTitle("fileTransfer.queue.retryTransfer")).toBeNull();
  });

  it("appears on a failed row and calls back with its id", async () => {
    const onRetry = renderQueue([{ ...base, status: "error", error: "connection reset" }]);
    await userEvent.click(screen.getByTitle("fileTransfer.queue.retryTransfer"));
    expect(onRetry).toHaveBeenCalledWith("t-1");
  });

  it("appears on a cancelled row", () => {
    renderQueue([{ ...base, status: "cancelled" }]);
    expect(screen.getByTitle("fileTransfer.queue.retryTransfer")).toBeTruthy();
  });
});
