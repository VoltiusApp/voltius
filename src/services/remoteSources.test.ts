import { describe, expect, test } from "vitest";
import { createRemoteSources, remoteSourceName } from "./remoteSources";

const v = (device_id: string, updated_at = "t1") => ({ device_id, updated_at });

describe("createRemoteSources", () => {
  const make = () => createRemoteSources(() => "now");

  test("a device seen for the first time is pending", () => {
    const s = make();
    s.track([v("a")]);
    expect(s.list()).toEqual([{ deviceId: "a", remoteUpdatedAt: "t1", state: "pending", syncedAt: null, failedAt: null, httpStatus: null }]);
  });

  test("an unchanged version keeps its result; a newer one goes back to pending but keeps its last read", () => {
    const s = make();
    s.track([v("a")]);
    s.succeeded(v("a"));
    s.track([v("a")]);
    expect(s.list()[0].state).toBe("synced");
    s.track([v("a", "t2")]);
    expect(s.list()[0]).toMatchObject({ state: "pending", remoteUpdatedAt: "t2", syncedAt: "now" });
  });

  test("a failure records its kind and status, and counts as failing", () => {
    const s = make();
    s.track([v("a"), v("b")]);
    s.failed(v("a"), "unavailable", 503);
    s.succeeded(v("b"));
    expect(s.failing()).toEqual([expect.objectContaining({ deviceId: "a", state: "unavailable", httpStatus: 503, failedAt: "now" })]);
  });

  test("a device no longer listed is dropped, and results for untracked devices are ignored", () => {
    const s = make();
    s.track([v("a"), v("b")]);
    s.track([v("b")]);
    s.succeeded(v("own"));
    expect(s.list().map((x) => x.deviceId)).toEqual(["b"]);
  });

  test("list keeps one reference until something changes, and listeners hear each change", () => {
    const s = make();
    let heard = 0;
    const off = s.subscribe(() => heard++);
    s.track([v("a")]);
    const first = s.list();
    expect(s.list()).toBe(first);
    s.drop("missing");
    expect(heard).toBe(1);
    s.clear();
    expect(s.list()).toEqual([]);
    expect(heard).toBe(2);
    off();
  });
});

test("remoteSourceName prefers the live-session manifest, then the local network list", () => {
  expect(remoteSourceName("a", { a: { deviceName: "laptop" } }, { a: { name: "lan" } })).toBe("laptop");
  expect(remoteSourceName("a", { a: { deviceName: "" } }, { a: { name: "lan" } })).toBe("lan");
  expect(remoteSourceName("a", {}, {})).toBeNull();
});
