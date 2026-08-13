import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const writeClipboard = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/utils/clipboard", () => ({ writeClipboard }));

import { InviteCodeField } from "./InviteCodeField";

const CODE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301:s3cr3t";

beforeEach(() => writeClipboard.mockClear());
afterEach(cleanup);

test("copies exactly the value it displays", async () => {
  render(<InviteCodeField code={CODE} />);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(CODE);

  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(CODE));
});

test("shows the copied state when the code arrived pre-copied", () => {
  render(<InviteCodeField code={CODE} autoCopied />);
  expect(screen.getByText("terminal.shared.copied")).toBeTruthy();
});

test("shows the idle copy label otherwise", () => {
  render(<InviteCodeField code={CODE} />);
  expect(screen.getByText("common.action.copy")).toBeTruthy();
});

test("auto-copied state persists past the manual-copy timer duration", () => {
  vi.useFakeTimers();
  try {
    render(<InviteCodeField code={CODE} autoCopied />);
    expect(screen.getByText("terminal.shared.copied")).toBeTruthy();
    vi.advanceTimersByTime(2000);
    expect(screen.getByText("terminal.shared.copied")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("a manual copy reverts to the idle label after its 2-second timer", async () => {
  vi.useFakeTimers();
  try {
    render(<InviteCodeField code={CODE} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
      await Promise.resolve(); // flush the awaited writeClipboard() microtask
    });
    expect(screen.getByText("terminal.shared.copied")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("common.action.copy")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
