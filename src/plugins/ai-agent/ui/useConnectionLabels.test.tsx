import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useConnectionLabels } from "./useConnectionLabels";
import * as storeMod from "../state/agentStore";
import { UNKNOWN_SCOPE } from "../state/scopeDerivation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CONNS = [
  { id: "c1", name: "Prod DB", host: "web-01", port: 22, username: "deploy", auth_type: "key", tags: [] },
];

describe("useConnectionLabels", () => {
  it("resolves a connection scope as pending before the load settles, then as connection", async () => {
    let resolveList: (list: typeof CONNS) => void;
    const pending = new Promise<typeof CONNS>((res) => { resolveList = res; });
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
      api: { connections: { list: () => pending } },
    } as never);

    const { result } = renderHook(() => useConnectionLabels());
    expect(result.current("c1")).toEqual({ kind: "pending", name: "c1", detail: null });

    resolveList!(CONNS);
    await waitFor(() => expect(result.current("c1").kind).toBe("connection"));
    expect(result.current("c1")).toEqual({ kind: "connection", name: "Prod DB", detail: "deploy@web-01:22" });
  });

  it("resolves local and the unknown sentinel immediately, even while pending", () => {
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
      api: { connections: { list: () => new Promise(() => {}) } },
    } as never);

    const { result } = renderHook(() => useConnectionLabels());
    expect(result.current("local")).toEqual({ kind: "local", name: "local", detail: null });
    expect(result.current(UNKNOWN_SCOPE)).toEqual({ kind: "unknown", name: UNKNOWN_SCOPE, detail: null });
  });

  it("settles to deleted immediately when there is no plugin api", () => {
    vi.spyOn(storeMod, "getAgentDeps").mockReturnValue(null);

    const { result } = renderHook(() => useConnectionLabels());
    expect(result.current("c1")).toEqual({ kind: "deleted", name: "c1", detail: "c1" });
  });
});
