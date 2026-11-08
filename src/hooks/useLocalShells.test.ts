// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/invoke", () => ({
  invoke: async () => [
    { name: "bash", path: "/bin/bash" },
    { name: "zsh", path: "/bin/zsh" },
  ],
}));

import { useLocalShells } from "./useLocalShells";
import { usePolicyStore } from "@/stores/policyStore";

describe("useLocalShells", () => {
  afterEach(() => usePolicyStore.setState({ machine: { policy: {}, defaults: {} } }));

  test("useLocalShells hides shells outside allowed", async () => {
    const { result } = renderHook(() => useLocalShells());
    await waitFor(() => expect(result.current).toHaveLength(2));
    act(() => {
      usePolicyStore.setState({
        machine: { policy: { "appSettings.terminal.preferredShell": { $range: { allowed: ["zsh"] } } }, defaults: {} },
      });
    });
    expect(result.current.map((s) => s.name)).toEqual(["zsh"]);
  });
});
