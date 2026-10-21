import { describe, expect, it } from "vitest";
import { backDepth, planBack, type BackState } from "./backCore";
import type { MobileNavState } from "@/stores/mobileNavCore";

const root: MobileNavState = { tab: "hosts", stack: [], sheet: null };
const closed = { settingsOpen: false, settingsSubPage: null };
const state = (p: Partial<BackState>): BackState => ({ interceptors: [], settings: closed, nav: root, ...p });

describe("backDepth", () => {
  it("stacks tab < pages < settings < settings drill-down", () => {
    expect(backDepth(root, closed)).toBe(0);
    expect(backDepth({ ...root, tab: "snippets" }, closed)).toBe(1);
    expect(backDepth({ ...root, stack: [{ kind: "account" }] }, closed)).toBe(1);
    expect(backDepth(root, { settingsOpen: true, settingsSubPage: null })).toBe(1);
    expect(backDepth({ ...root, tab: "more", stack: [{ kind: "account" }] }, { settingsOpen: true, settingsSubPage: "appearance" })).toBe(4);
  });
});

describe("planBack", () => {
  it("returns null at root: the system handles the press", () => {
    expect(planBack(state({}))).toBeNull();
  });

  it("closes interceptors LIFO before anything else on their layer", () => {
    const s = state({
      interceptors: [{ id: 1, depth: 1 }, { id: 2, depth: 1 }],
      nav: { tab: "hosts", stack: [{ kind: "host-edit" }], sheet: null },
    });
    expect(planBack(s)).toEqual({ kind: "interceptor", id: 2 });
  });

  it("closes a sheet opened over settings before the settings page", () => {
    const settings = { settingsOpen: true, settingsSubPage: "appearance" };
    const s = state({ settings, interceptors: [{ id: 7, depth: backDepth(root, settings) }] });
    expect(planBack(s)).toEqual({ kind: "interceptor", id: 7 });
  });

  it("settings drill-down → settings list → closed", () => {
    expect(planBack(state({ settings: { settingsOpen: true, settingsSubPage: "appearance" } }))).toEqual({ kind: "settings-subpage" });
    expect(planBack(state({ settings: { settingsOpen: true, settingsSubPage: null } }))).toEqual({ kind: "settings" });
  });

  it("skips interceptors of a covered layer (Hosts folder level under Settings)", () => {
    const s = state({ interceptors: [{ id: 3, depth: 0 }], settings: { settingsOpen: true, settingsSubPage: null } });
    expect(planBack(s)).toEqual({ kind: "settings" });
    // Once settings is closed the folder level is on top again.
    expect(planBack(state({ interceptors: [{ id: 3, depth: 0 }] }))).toEqual({ kind: "interceptor", id: 3 });
  });

  it("covered-layer interceptor waits for the page above to pop", () => {
    const s = state({ interceptors: [{ id: 4, depth: 2 }], nav: { tab: "more", stack: [{ kind: "more-page", page: "keychain" }, { kind: "key-edit" }], sheet: null } });
    expect(planBack(s)).toEqual({ kind: "nav" });
  });

  it("falls back to the nav store: sheet, stack page, non-hosts tab", () => {
    expect(planBack(state({ nav: { ...root, sheet: { kind: "sync" } } }))).toEqual({ kind: "nav" });
    expect(planBack(state({ nav: { ...root, stack: [{ kind: "account" }] } }))).toEqual({ kind: "nav" });
    expect(planBack(state({ nav: { ...root, tab: "terminal" } }))).toEqual({ kind: "nav" });
  });
});
