import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  sync: vi.fn(async () => {}),
  enabled: { value: false },
  setEnabled: vi.fn(),
}));
vi.mock("@/mcp/enable", () => ({ syncMcpServer: h.sync }));
vi.mock("@/stores/toggleSettingsStore", () => ({
  useToggle: () => [h.enabled.value, h.setEnabled],
}));

import { useMcpServerSync } from "./useMcpServerSync";

function Harness() {
  useMcpServerSync();
  return null;
}

beforeEach(() => {
  h.sync.mockClear();
  h.setEnabled.mockClear();
  h.enabled.value = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("pushes the current toggle value to the backend on mount", async () => {
  h.enabled.value = true;
  await act(async () => {
    render(<Harness />);
  });
  expect(h.sync).toHaveBeenCalledWith(true);
});

test("pushes the new value again when the toggle flips", async () => {
  const { rerender } = render(<Harness />);
  await act(async () => {});
  h.sync.mockClear();

  h.enabled.value = true;
  await act(async () => {
    rerender(<Harness />);
  });
  expect(h.sync).toHaveBeenCalledWith(true);
});

test("reverts the toggle when the backend cannot start the listener", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled.value = true;
  h.sync.mockRejectedValueOnce(new Error("pipe busy"));
  await act(async () => {
    render(<Harness />);
  });
  expect(h.setEnabled).toHaveBeenCalledWith(false);
});

test("does not turn the toggle back on when a disable fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.sync.mockRejectedValueOnce(new Error("boom"));
  await act(async () => {
    render(<Harness />);
  });
  expect(h.setEnabled).not.toHaveBeenCalled();
});
