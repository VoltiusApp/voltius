import { describe, it, expect, beforeEach } from "vitest";
import { useMcpOwnershipStore } from "./mcpOwnershipStore";

const store = () => useMcpOwnershipStore.getState();

beforeEach(() => {
  useMcpOwnershipStore.setState({ owners: {}, busy: {} });
});

describe("mcpOwnershipStore", () => {
  it("claim records the owner and release drops it", () => {
    store().claim("s1", { clientId: "c1", clientName: "Claude Code" });
    expect(store().owners.s1.clientName).toBe("Claude Code");
    store().release("s1");
    expect(store().owners.s1).toBeUndefined();
  });

  it("clearClient drops only that client's sessions", () => {
    store().claim("s1", { clientId: "c1", clientName: "A" });
    store().claim("s2", { clientId: "c2", clientName: "B" });
    store().clearClient("c1");
    expect(Object.keys(store().owners)).toEqual(["s2"]);
  });

  it("keepOnly prunes owners and busy counters for sessions that are gone", () => {
    store().claim("s1", { clientId: "c1", clientName: "A" });
    store().claim("s2", { clientId: "c1", clientName: "A" });
    store().beginActivity("s2");
    store().keepOnly(["s1"]);
    expect(Object.keys(store().owners)).toEqual(["s1"]);
    expect(store().busy.s2).toBeUndefined();
  });

  it("nested activity needs as many ends as begins", () => {
    store().beginActivity("s1");
    store().beginActivity("s1");
    store().endActivity("s1");
    expect(store().busy.s1).toBe(1);
    store().endActivity("s1");
    expect(store().busy.s1).toBeUndefined();
  });

  it("endActivity on an idle session never goes negative", () => {
    store().endActivity("s1");
    expect(store().busy.s1).toBeUndefined();
  });

  it("claim caps clientName at 40 characters", () => {
    store().claim("s1", { clientId: "c1", clientName: "a".repeat(50) });
    expect(store().owners.s1.clientName).toBe("a".repeat(40));
  });

  it("release keeps the busy counter alone so an in-flight call still resolves", () => {
    store().claim("s1", { clientId: "c1", clientName: "A" });
    store().beginActivity("s1");
    store().release("s1");
    expect(store().busy.s1).toBe(1);
  });
});
