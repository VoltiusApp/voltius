import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAllConnections, useConnection } from "./useAllConnections";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamStore } from "@/stores/teamStore";
import type { Connection } from "@/types";

const conn = (id: string, name: string) => ({ id, name }) as unknown as Connection;

function seed() {
  useTeamStore.setState({ teams: [{ id: "t1" }, { id: "t2" }] as never });
  useConnectionStore.setState({
    connections: [conn("a", "personal a"), conn("b", "personal b")],
    teamConnections: { t1: [conn("b", "team1 b"), conn("c", "team1 c")], t2: [conn("c", "team2 c")], gone: [conn("d", "old team d")] },
  });
}

afterEach(() => {
  useTeamStore.setState({ teams: [] });
  useConnectionStore.setState({ connections: [], teamConnections: {} });
});

describe("useConnection", () => {
  it("resolves an id exactly like a lookup in useAllConnections", () => {
    seed();
    const all = renderHook(() => useAllConnections()).result.current;
    for (const id of ["a", "b", "c", "d", "missing"]) {
      const { result } = renderHook(() => useConnection(id));
      expect(result.current).toBe(all.find((c) => c.id === id));
    }
    expect(renderHook(() => useConnection(undefined)).result.current).toBeUndefined();
  });

  it("does not re-render when another connection changes", () => {
    seed();
    let renders = 0;
    renderHook(() => {
      renders++;
      return useConnection("a");
    });
    const before = renders;
    act(() => {
      useConnectionStore.setState((s) => ({ connections: [s.connections[0], conn("b", "renamed")] }));
    });
    expect(renders).toBe(before);
  });
});
