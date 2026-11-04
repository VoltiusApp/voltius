// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/saveFile", () => ({ notify: mocks.notify }));

import { adminDefault, isLocked, lockedValue, onPolicyLoaded, usePolicyStore } from "./policyStore";

const empty = { policy: {}, defaults: {} };
const loaded = (policy = {}, defaults = {}, issues: unknown[] = []) => ({
  path: "/etc/voltius/policy.json",
  doc: { version: 1, policy, defaults },
  issues,
});

describe("policyStore", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.notify.mockReset();
    usePolicyStore.setState({ machine: empty, server: empty, issues: [] });
  });

  it("lockedValue prefers server over machine", () => {
    usePolicyStore.setState({
      machine: { policy: { k: 1 }, defaults: {} },
      server: { policy: { k: 2 }, defaults: {} },
    });
    expect(lockedValue("k")).toEqual({ locked: true, value: 2, source: "server" });
    expect(isLocked("k")).toBe(true);
  });

  it("unlocked when neither layer has the key", () => {
    expect(lockedValue("k")).toEqual({ locked: false });
    expect(isLocked("k")).toBe(false);
  });

  it("adminDefault reads defaults, not policy", () => {
    usePolicyStore.setState({
      machine: { policy: { a: 1 }, defaults: { b: 2 } },
      server: { policy: {}, defaults: { b: 3 } },
    });
    expect(adminDefault("a")).toBeUndefined();
    expect(adminDefault("b")).toBe(3);
  });

  it("load surfaces a broken file as an issue and notifies once per issue set", async () => {
    const issue = { layer: null, key: null, message: "invalid JSON" };
    mocks.invoke.mockResolvedValue(loaded({}, {}, [issue]));
    await usePolicyStore.getState().load();
    expect(usePolicyStore.getState().issues).toHaveLength(1);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    await usePolicyStore.getState().load();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("notifies again when issues clear and return", async () => {
    const issue = { layer: "policy", key: "x", message: "unknown key; ignored" };
    mocks.invoke.mockResolvedValueOnce(loaded({}, {}, [issue]));
    await usePolicyStore.getState().load();
    mocks.invoke.mockResolvedValueOnce(loaded());
    await usePolicyStore.getState().load();
    mocks.invoke.mockResolvedValueOnce(loaded({}, {}, [issue]));
    await usePolicyStore.getState().load();
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it("runs onPolicyLoaded subscribers after each load", async () => {
    const fn = vi.fn();
    const off = onPolicyLoaded(fn);
    mocks.invoke.mockResolvedValue(loaded({ k: true }));
    await usePolicyStore.getState().load();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(usePolicyStore.getState().machine.policy).toEqual({ k: true });
    off();
    await usePolicyStore.getState().load();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
