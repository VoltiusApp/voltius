// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/saveFile", () => ({ notify: mocks.notify }));

import {
  adminDefault,
  isEnforcedLock,
  isLocked,
  lockedBool,
  lockedList,
  lockedValue,
  onPolicyLoaded,
  usePolicyStore,
  watchPolicyVisibility,
} from "./policyStore";

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
    const issue = { kind: "file", layer: null, key: null, message: "invalid JSON" };
    mocks.invoke.mockResolvedValue(loaded({}, {}, [issue]));
    await usePolicyStore.getState().load();
    expect(usePolicyStore.getState().issues).toHaveLength(1);
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    await usePolicyStore.getState().load();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("notifies again when issues clear and return", async () => {
    const issue = { kind: "type", layer: "policy", key: "x", message: "value does not match type bool; ignored" };
    mocks.invoke.mockResolvedValueOnce(loaded({}, {}, [issue]));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    mocks.invoke.mockResolvedValueOnce(loaded());
    await usePolicyStore.getState().load();
    mocks.invoke.mockResolvedValueOnce(loaded({}, {}, [issue]));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(2));
  });

  it("only logs unknown keys, newer versions and range entries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const issues = [
      { kind: "unknownKey", layer: "policy", key: "nope", message: "unknown key; ignored" },
      { kind: "newerVersion", layer: null, key: null, message: "policy version 2 is newer" },
      { kind: "range", layer: "policy", key: "k", message: "range entries need a newer Voltius; ignored" },
    ];
    mocks.invoke.mockResolvedValue(loaded({}, {}, issues));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.notify).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("toasts with the count of real file errors only", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const issues = [
      { kind: "unknownKey", layer: "policy", key: "nope", message: "unknown key; ignored" },
      { kind: "type", layer: "policy", key: "sshConfig.import", message: "value does not match type bool; ignored" },
    ];
    mocks.invoke.mockResolvedValue(loaded({}, {}, issues));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    vi.mocked(console.warn).mockRestore();
  });

  it("says none of it applies when the file could not be read", async () => {
    mocks.invoke.mockResolvedValue(loaded({}, {}, [{ kind: "file", layer: null, key: null, message: "invalid JSON" }]));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith("error", "common.policy.fileError"));
  });

  it("says the file was ignored when standard users can change it", async () => {
    const unprotected = { kind: "unprotected", layer: null, key: null, message: "standard users can change it" };
    mocks.invoke.mockResolvedValue(loaded({}, {}, [unprotected]));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith("error", "common.policy.unprotected"));
  });

  it("keeps the partial message for type issues and for a bad layer beside a good one", async () => {
    const type = { kind: "type", layer: "policy", key: "x", message: "value does not match type bool; ignored" };
    mocks.invoke.mockResolvedValueOnce(loaded({}, {}, [type]));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenLastCalledWith("error", "common.policy.issues"));
    const layer = { kind: "file", layer: "policy", key: null, message: "\"policy\" must be an object" };
    mocks.invoke.mockResolvedValueOnce(loaded({}, { "appSettings.locale": "fr" }, [layer]));
    await usePolicyStore.getState().load();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(2));
    expect(mocks.notify).toHaveBeenLastCalledWith("error", "common.policy.issues");
  });

  it("a failed load leaves the state alone and does not throw", async () => {
    usePolicyStore.setState({ machine: { policy: { k: true }, defaults: {} } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invoke.mockRejectedValue(new Error("boom"));
    await expect(usePolicyStore.getState().load()).resolves.toBeUndefined();
    expect(usePolicyStore.getState().machine.policy).toEqual({ k: true });
    warn.mockRestore();
  });

  it("watchPolicyVisibility installs one listener", () => {
    const add = vi.spyOn(document, "addEventListener");
    watchPolicyVisibility();
    watchPolicyVisibility();
    expect(add.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
    add.mockRestore();
  });

  it("typed lock readers ignore values of the wrong type", () => {
    usePolicyStore.setState({ machine: { policy: { b: false, l: ["x"], s: "str" }, defaults: {} } });
    expect(lockedBool("b")).toBe(false);
    expect(lockedBool("s")).toBeUndefined();
    expect(lockedList("l")).toEqual(["x"]);
    expect(lockedList("b")).toBeUndefined();
    expect(lockedBool("missing")).toBeUndefined();
  });

  it("isEnforcedLock needs both a lock and an enforced key", () => {
    usePolicyStore.setState({
      machine: { policy: { "appSettings.toggles.cursor-blink": true, "appSettings.locale": "fr" }, defaults: {} },
    });
    expect(isEnforcedLock("appSettings.toggles.cursor-blink")).toBe(true);
    expect(isEnforcedLock("appSettings.locale")).toBe(false);
    expect(isEnforcedLock("appSettings.toggles.select-to-copy")).toBe(false);
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
