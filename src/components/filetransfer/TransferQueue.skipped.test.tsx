import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TransferQueue } from "./TransferQueue";
import type { Transfer } from "./SFTPTypes";

afterEach(() => cleanup());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${String(opts.count)}` : key,
  }),
}));

const done: Transfer = {
  id: "t-1", label: "logs", direction: "←", transferred: 10, total: 10, status: "done", settled: true,
};

const renderQueue = (transfers: Transfer[]) =>
  render(
    <TransferQueue transfers={transfers} onClear={vi.fn()} onCancel={vi.fn()} onCancelAll={vi.fn()} onRetry={vi.fn()} />,
  );

describe("skipped names", () => {
  it("lists every skipped remote path under a finished transfer", () => {
    renderQueue([{ ...done, skipped: ["/var/log/10:30.log", "/var/log/a\\b"] }]);
    expect(screen.getByText("fileTransfer.queue.skipped:2")).toBeTruthy();
    expect(screen.getByText("/var/log/10:30.log")).toBeTruthy();
    expect(screen.getByText("/var/log/a\\b")).toBeTruthy();
  });

  it("says nothing when no name was skipped", () => {
    renderQueue([done]);
    expect(screen.queryByText(/fileTransfer\.queue\.skipped/)).toBeNull();
  });
});
