import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  sync: vi.fn(async () => {}),
  enabled: { value: false },
  setEnabled: vi.fn(),
  os: { value: "linux" },
}));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", getPlatform: async () => h.os.value }));
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
  h.os.value = "linux";
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

test("never touches the backend or the synced toggle on Android", async () => {
  // A desktop turned the server on and the setting synced to the phone.
  h.os.value = "android";
  h.enabled.value = true;
  const { rerender } = render(<Harness />);
  await act(async () => {});
  h.enabled.value = false;
  await act(async () => {
    rerender(<Harness />);
  });
  expect(h.sync).not.toHaveBeenCalled();
  expect(h.setEnabled).not.toHaveBeenCalled();
});
