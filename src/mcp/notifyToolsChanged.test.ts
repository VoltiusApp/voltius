import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startToolsChangedNotifier } from "./notifyToolsChanged";
import { registerContributions, clearContributions } from "./contributions";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const TOOL = {
  name: "a",
  description: "A.",
  inputSchema: { type: "object" },
  execute: async () => 1,
};

describe("the tools-changed notifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Resolved, not bare: the notifier awaits the real `invoke`'s promise.
    invoke.mockReset().mockResolvedValue(undefined);
    clearContributions("p-one");
    clearContributions("p-two");
  });
  afterEach(() => vi.useRealTimers());

  it("collapses a burst of registrations into one invoke", () => {
    const stop = startToolsChangedNotifier();
    registerContributions("p-one", [TOOL]);
    registerContributions("p-two", [TOOL]);
    vi.advanceTimersByTime(300);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("mcp_notify_tools_changed");
    stop();
  });

  it("cancels a timer that is already armed when teardown runs", () => {
    const stop = startToolsChangedNotifier();
    registerContributions("p-one", [TOOL]);
    vi.advanceTimersByTime(100);
    stop();
    vi.advanceTimersByTime(300);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stops notifying after teardown", () => {
    const stop = startToolsChangedNotifier();
    stop();
    registerContributions("p-one", [TOOL]);
    vi.advanceTimersByTime(300);
    expect(invoke).not.toHaveBeenCalled();
  });
});
