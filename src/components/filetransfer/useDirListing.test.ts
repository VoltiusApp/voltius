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
});
