import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TransferQueue } from "./TransferQueue";
import type { Transfer } from "./SFTPTypes";

afterEach(() => cleanup());

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.size !== undefined ? `${key}:${String(opts.size)}` : key,
  }),
}));

const running: Transfer = {
  id: "t-1", label: "v.mp4", direction: "→", transferred: 0, total: 8 * 1024 ** 3, status: "running",
};

const renderQueue = (transfers: Transfer[]) =>
  render(
    <TransferQueue transfers={transfers} onClear={vi.fn()} onCancel={vi.fn()} onCancelAll={vi.fn()} onRetry={vi.fn()} />,
  );

describe("resumable transfers", () => {
  it("labels a transfer waiting for its connection", () => {
    renderQueue([{ ...running, waiting: true }]);
    expect(screen.getByText("fileTransfer.queue.waiting")).toBeTruthy();
  });

  it("shows where a transfer resumed", () => {
    renderQueue([{ ...running, resumedAt: 4 * 1024 ** 3, transferred: 4 * 1024 ** 3 }]);
    expect(screen.getByText("fileTransfer.queue.resumedAt:4.00 GB")).toBeTruthy();
  });

  it("shows neither on a transfer that never dropped", () => {
    renderQueue([running]);
    expect(screen.queryByText(/fileTransfer\.queue\.(waiting|resumedAt)/)).toBeNull();
  });
});
