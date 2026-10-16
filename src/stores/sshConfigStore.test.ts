// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { managedAliasOf, managedOwnedOf, useManagedOwned, useSshConfigStore } from "./sshConfigStore";

beforeEach(() => useSshConfigStore.setState({ state: {}, status: { skipped: [] }, dialog: null }));

describe("sshConfigStore", () => {
  it("reports the alias of a live entry only", () => {
    useSshConfigStore.getState().setState({ managed: { c1: { alias: "web", at: 1, devices: {} }, c2: { alias: "db", at: 1, gone: "detached", devices: {} } } });
    expect(managedAliasOf("c1")).toBe("web");
    expect(managedAliasOf("c2")).toBeUndefined();
    expect(managedAliasOf(undefined)).toBeUndefined();
  });

  it("derives the owned fields from the newest present device", () => {
    const old = JSON.stringify(["h", 22, "u", "~/.ssh/id", ""]);
    const fresh = JSON.stringify(["h", 22, "", "", ""]);
    useSshConfigStore.getState().setState({ managed: {
      c1: { alias: "web", at: 1, devices: {} },
      c3: { alias: "k", at: 1, devices: { d1: { present: true, hash: old, at: 1 }, d2: { present: true, hash: fresh, at: 5 }, d3: { present: false, hash: old, at: 9 } } },
    } });
    expect(managedOwnedOf("c1")).toEqual(["connection_type", "host", "port"]);
    expect(managedOwnedOf("c3")).toEqual(["connection_type", "host", "port"]);
    expect(managedOwnedOf("nope")).toEqual([]);
  });

  it("keeps useManagedOwned stable for a host with user and identity", () => {
    const hash = JSON.stringify(["h", 22, "u", "~/.ssh/id", ""]);
    useSshConfigStore.getState().setState({ managed: { c1: { alias: "web", at: 1, devices: { d1: { present: true, hash, at: 1 } } } } });
    const expected = ["connection_type", "host", "port", "username", "auth_type", "identity_id", "key_id"];
    const { result } = renderHook(() => useManagedOwned("c1"));
    expect(result.current).toEqual(expected);
    act(() => useSshConfigStore.getState().setStatus({ error: "x" }));
    expect(result.current).toEqual(expected);
  });
});
