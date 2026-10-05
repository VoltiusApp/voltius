// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pending: new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }[]>(),
}));

const deferred = (path: string) =>
  new Promise((resolve, reject) => {
    h.pending.set(path, [...(h.pending.get(path) ?? []), { resolve, reject }]);
  });

vi.mock("@/services/sftp", () => ({
  fsListDir: (path: string) => deferred(path),
  sftpListDir: (_id: string, path: string) => deferred(path),
}));

import { useDirListing } from "./useDirListing";
import { BackendError } from "@/services/backendErrors";

const listing = (dir: string) => [{ name: "f", path: `${dir}/f`, size: 1, is_dir: false, modified: null }];
const settle = async (path: string, i: number, outcome: "resolve" | "reject") => {
  await act(async () => {
    const p = h.pending.get(path)![i];
    if (outcome === "resolve") p.resolve(listing(path));
    else p.reject("denied");
  });
};

beforeEach(() => { h.pending.clear(); });

describe("useDirListing", () => {
  it("ignores a slow listing of a directory the user already left", async () => {
    const { result, rerender } = renderHook(({ cwd }) => useDirListing(false, "s1", cwd, 0), { initialProps: { cwd: "/old" } });
    rerender({ cwd: "/new" });

    await settle("/new", 0, "resolve");
    expect(result.current.entries.map((e) => e.path)).toEqual(["/new/f"]);

    await settle("/old", 0, "resolve");
    expect(result.current.entries.map((e) => e.path)).toEqual(["/new/f"]);
  });

  it("ignores a reload superseded by a newer one", async () => {
    const { result, rerender } = renderHook(({ tick }) => useDirListing(true, null, "/d", tick), { initialProps: { tick: 0 } });
    rerender({ tick: 1 });
    await settle("/d", 1, "reject");
    await settle("/d", 0, "resolve");
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBe("denied");
    expect(result.current.loading).toBe(false);
  });

  it("keeps loading until the new directory lands even when a reload cancels its first listing", async () => {
    const { result, rerender } = renderHook(({ cwd, tick }) => useDirListing(false, "s1", cwd, tick), { initialProps: { cwd: "/a", tick: 0 } });
    await settle("/a", 0, "resolve");
    rerender({ cwd: "/b", tick: 0 });
    expect(result.current.loading).toBe(true);
    rerender({ cwd: "/b", tick: 1 });
    await settle("/b", 1, "reject");
    expect(result.current.error).toBe("denied");
    expect(result.current.loading).toBe(false);
  });

  // Auto-refresh ticks faster than a slow listing returns; cancelling on each tick meant nothing ever landed.
  it("lets a slow listing land even after a reload was issued", async () => {
    const { result, rerender } = renderHook(({ tick }) => useDirListing(false, "s1", "/big", tick), { initialProps: { tick: 0 } });
    rerender({ tick: 1 });
    rerender({ tick: 2 });
    await settle("/big", 0, "resolve");
    expect(result.current.loading).toBe(false);
    expect(result.current.entries.map((e) => e.path)).toEqual(["/big/f"]);
  });

  it("does not let an older reload overwrite a newer one", async () => {
    const { result, rerender } = renderHook(({ tick }) => useDirListing(true, null, "/d", tick), { initialProps: { tick: 0 } });
    rerender({ tick: 1 });
    await act(async () => { h.pending.get("/d")![1].resolve([{ name: "new", path: "/d/new", size: 1, is_dir: false, modified: null }]); });
    await settle("/d", 0, "resolve");
    expect(result.current.entries.map((e) => e.name)).toEqual(["new"]);
  });

  it("hides remote entries whose name is not one path segment", async () => {
    const { result } = renderHook(() => useDirListing(false, "s1", "/r", 0));
    const names = ["ok", "a/../../x", "..", "."];
    await act(async () => {
      h.pending.get("/r")![0].resolve(names.map((name) => ({ name, path: `/r/${name}`, size: 1, is_dir: false, modified: null })));
    });
    expect(result.current.entries.map((e) => e.name)).toEqual(["ok"]);
  });

  it("reports a coded listing error's code beside its message", async () => {
    const { result } = renderHook(() => useDirListing(false, "s1", "/root", 0));
    await act(async () => { h.pending.get("/root")![0].reject(new BackendError("permission-denied", "Permission denied")); });
    expect(result.current.errorCode).toBe("permission-denied");
    expect(result.current.error).toBeTruthy();
  });

  it("keeps the shown entries and reports a failed refresh until a reload succeeds", async () => {
    const { result, rerender } = renderHook(({ tick }) => useDirListing(false, "s1", "/d", tick), { initialProps: { tick: 0 } });
    await settle("/d", 0, "resolve");
    rerender({ tick: 1 });
    await settle("/d", 1, "reject");
    expect(result.current.entries.map((e) => e.path)).toEqual(["/d/f"]);
    expect(result.current.error).toBeNull();
    expect(result.current.refreshError).toBe("denied");

    rerender({ tick: 2 });
    await settle("/d", 2, "resolve");
    expect(result.current.refreshError).toBeNull();
  });

  it("keeps reporting a failed directory as an error, not a failed refresh", async () => {
    const { result, rerender } = renderHook(({ tick }) => useDirListing(false, "s1", "/d", tick), { initialProps: { tick: 0 } });
    await settle("/d", 0, "reject");
    rerender({ tick: 1 });
    await settle("/d", 1, "reject");
    expect(result.current.error).toBe("denied");
    expect(result.current.refreshError).toBeNull();
  });

  it("stops loading when a refresh of the directory shown fails after leaving and coming back", async () => {
    const { result, rerender } = renderHook(({ cwd }) => useDirListing(false, "s1", cwd, 0), { initialProps: { cwd: "/a" } });
    await settle("/a", 0, "resolve");
    rerender({ cwd: "/b" });
    rerender({ cwd: "/a" });
    await settle("/a", 1, "reject");
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshError).toBe("denied");
  });

  it("drops a failed refresh's report on leaving the directory", async () => {
    const { result, rerender } = renderHook(({ cwd, tick }) => useDirListing(false, "s1", cwd, tick), { initialProps: { cwd: "/a", tick: 0 } });
    await settle("/a", 0, "resolve");
    rerender({ cwd: "/a", tick: 1 });
    await settle("/a", 1, "reject");
    rerender({ cwd: "/b", tick: 1 });
    expect(result.current.refreshError).toBeNull();
  });

  it("does not list while a remote pane has no session", () => {
    renderHook(() => useDirListing(false, null, "/r", 0));
    expect(h.pending.size).toBe(0);
  });
});
