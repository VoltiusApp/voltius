import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ sync: vi.fn(async () => {}), enabled: { value: false } }));
vi.mock("@/mcp/enable", () => ({ syncMcpServer: h.sync }));
vi.mock("@/stores/toggleSettingsStore", () => ({
  useToggle: () => [h.enabled.value, () => {}],
}));

import { useMcpServerSync } from "./useMcpServerSync";

function Harness() {
  useMcpServerSync();
  return null;
}

beforeEach(() => {
  h.sync.mockClear();
  h.enabled.value = false;
});
afterEach(() => cleanup());

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
