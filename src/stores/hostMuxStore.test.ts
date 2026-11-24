import { test, expect, beforeEach } from "vitest";
import { useHostMuxStore, muxFromMode, needsNotify } from "./hostMuxStore.ts";

const get = () => useHostMuxStore.getState();

beforeEach(() => useHostMuxStore.setState({ hosts: {}, installing: {}, lastFailure: {} }));

test("muxFromMode maps control mode to tmux-cc with the version", () => {
  expect(muxFromMode({ control: true, tmux: "3.8", fallback: null })).toEqual({ kind: "tmux-cc", version: "3.8" });
});

test("muxFromMode maps fallbacks", () => {
  expect(muxFromMode({ control: false, tmux: "", fallback: "screen" })).toEqual({ kind: "screen" });
  expect(muxFromMode({ control: false, tmux: "", fallback: "none" })).toEqual({ kind: "none" });
  expect(muxFromMode({ control: false, tmux: "", fallback: "tmux 3.0a" })).toEqual({ kind: "tmux-old", version: "3.0a" });
});

test("muxFromMode returns null for an unknown fallback", () => {
  expect(muxFromMode({ control: false, tmux: "", fallback: "" })).toBeNull();
});

test("record keeps notified when the kind is unchanged", () => {
  get().record("c1", { kind: "screen" });
  get().markNotified("c1", "screen");
  get().record("c1", { kind: "screen" });
  expect(get().hosts.c1.notified).toBe("screen");
});

test("record clears notified when the kind changes", () => {
  get().record("c1", { kind: "screen" });
  get().markNotified("c1", "screen");
  get().record("c1", { kind: "none" });
  expect(get().hosts.c1.notified).toBeUndefined();
});

test("record preserves voltius info", () => {
  get().record("c1", { kind: "none" });
  get().setVoltius("c1", { active: "3.8", versions: ["3.8"], inUse: {} });
  get().record("c1", { kind: "tmux-cc", version: "3.8" });
  expect(get().hosts.c1.voltius?.active).toBe("3.8");
});

test("forget removes the host", () => {
  get().record("c1", { kind: "none" });
  get().forget("c1");
  expect(get().hosts.c1).toBeUndefined();
});

test("needsNotify is true once per downgraded kind", () => {
  expect(needsNotify(undefined)).toBe(false);
  get().record("c1", { kind: "tmux-old", version: "3.0a" });
  expect(needsNotify(get().hosts.c1)).toBe(true);
  get().markNotified("c1", "tmux-old");
  expect(needsNotify(get().hosts.c1)).toBe(false);
});

test("needsNotify is false for tmux-cc and unsupported", () => {
  get().record("a", { kind: "tmux-cc", version: "3.8" });
  get().record("b", { kind: "unsupported" });
  expect(needsNotify(get().hosts.a)).toBe(false);
  expect(needsNotify(get().hosts.b)).toBe(false);
});

test("install progress and failures are set, cleared and never persisted", () => {
  get().setInstalling("c1", { step: "verify", progress: 85, quiet: true });
  get().setFailure("c1", "checksum");
  expect(get().installing.c1).toEqual({ step: "verify", progress: 85, quiet: true });
  expect(get().lastFailure.c1).toBe("checksum");
  const persisted = useHostMuxStore.persist.getOptions().partialize!(get());
  expect(Object.keys(persisted)).toEqual(["hosts"]);
  get().setInstalling("c1", undefined);
  get().setFailure("c1", undefined);
  expect(get().installing).toEqual({});
  expect(get().lastFailure).toEqual({});
});
