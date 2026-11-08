// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn(), applyCliPending: vi.fn(), writeCliMirror: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/cliBridge", () => ({ applyCliPending: mocks.applyCliPending, writeCliMirror: mocks.writeCliMirror }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/saveFile", () => ({ notify: mocks.notify }));

import {
  adminDefault,
  clampToRange,
  inPolicyRange,
  isEnforcedLock,
  isLocked,
  lockedBool,
  lockedList,
  lockedValue,
  onPolicyLoaded,
  policyRange,
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

  it("a refocus reloads policy and applies CLI changes once per focus/visibility pair", async () => {
    mocks.invoke.mockResolvedValue(loaded());
    mocks.applyCliPending.mockResolvedValue(undefined);
    mocks.writeCliMirror.mockResolvedValue(undefined);
    watchPolicyVisibility();
    const settle = () => new Promise((r) => setTimeout(r, 10));
    const visibility = (v: string) => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
    const loads = () => mocks.invoke.mock.calls.filter(([c]) => c === "policy_load").length;

    visibility("visible");
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(mocks.applyCliPending).toHaveBeenCalledTimes(1));
    await settle();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(mocks.applyCliPending).toHaveBeenCalledTimes(2));
    await settle();
    expect(loads()).toBe(2);
    expect(mocks.applyCliPending).toHaveBeenCalledTimes(2);

    visibility("hidden");
    window.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(mocks.writeCliMirror).toHaveBeenCalledTimes(1));
    await settle();
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mocks.writeCliMirror).toHaveBeenCalledTimes(2);
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
      machine: { policy: { "appSettings.toggles.cursor-blink": true, "appSettings.plugins.overrides": {} }, defaults: {} },
    });
    expect(isEnforcedLock("appSettings.toggles.cursor-blink")).toBe(true);
    expect(isEnforcedLock("appSettings.plugins.overrides")).toBe(false);
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

  describe("ranges and implied locks", () => {
    const TTL = "appSettings.detachedTtlHours";
    const TTL_TOGGLE = "appSettings.toggles.detached-session-ttl";
    const KEYWORDS = "appSettings.terminal.keywordRules";
    const withPolicy = (policy: Record<string, unknown>) =>
      usePolicyStore.setState({ machine: { policy, defaults: {} }, server: empty });

    it("a range entry is not a lock", () => {
      withPolicy({ [TTL]: { $range: { max: 24 } } });
      expect(lockedValue(TTL)).toEqual({ locked: false });
      expect(policyRange(TTL)).toEqual({ max: 24 });
      expect(inPolicyRange(policyRange(TTL), 72)).toBe(false);
      expect(inPolicyRange(policyRange(TTL), 12)).toBe(true);
    });

    it("TTL range implies the detached-session-ttl toggle", () => {
      withPolicy({ [TTL]: { $range: { max: 24 } } });
      expect(lockedValue(TTL_TOGGLE)).toEqual({ locked: true, value: true, source: "machine" });
    });

    it("implied lock beats an explicit off", () => {
      withPolicy({ [TTL]: { $range: { max: 24 } }, [TTL_TOGGLE]: false });
      expect(lockedValue(TTL_TOGGLE)).toEqual({ locked: true, value: true, source: "machine" });
    });

    it("keyword lock is not an enforced lock", () => {
      withPolicy({ [KEYWORDS]: [] });
      expect(isLocked(KEYWORDS)).toBe(true);
      expect(isEnforcedLock(KEYWORDS)).toBe(false);
      expect(lockedValue("appSettings.toggles.keyword-highlight").locked).toBe(true);
    });

    it("clampToRange pins a number into the bounds", () => {
      expect(clampToRange({ min: 5, max: 10 }, 1)).toBe(5);
      expect(clampToRange({ min: 5, max: 10 }, 99)).toBe(10);
      expect(clampToRange(undefined, 7)).toBe(7);
      expect(clampToRange({ min: 5 }, 1)).toBe(5);
      expect(clampToRange({ max: 5 }, 9)).toBe(5);
    });
  });
});
