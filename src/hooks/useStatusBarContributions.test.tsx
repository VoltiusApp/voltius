import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import { useStatusBarContributions } from "./useStatusBarContributions";

describe("useStatusBarContributions titlebar.right", () => {
  beforeEach(() => {
    useUIContributionStore.setState({ statusBarContributions: new Map(), contributions: new Map() });
  });

  it("returns titlebar.right nodes with no ctx", () => {
    useUIContributionStore.getState().registerStatusBarContribution("p1", "titlebar.right", () => "AI");
    const { result } = renderHook(() => useStatusBarContributions("titlebar.right"));
    expect(result.current.map((r) => r.node)).toEqual(["AI"]);
  });

  it("does not leak titlebar items into the terminal slot", () => {
    useUIContributionStore.getState().registerStatusBarContribution("p1", "titlebar.right", () => "AI");
    const { result } = renderHook(() =>
      useStatusBarContributions("terminal.statusBar.right", {
        sessionId: "s", sessionType: "ssh", connectionId: "c", sessionStatus: "connected",
      }),
    );
    expect(result.current).toEqual([]);
  });
});
