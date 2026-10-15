// @vitest-environment jsdom
import { test, expect } from "vitest";
import type { Connection } from "@/types";
import { partitionRecentHosts, pinnedThenRecent, recentlyUsed } from "./recentHosts";

const host = (id: string, last_used_at: string | null = null): Connection =>
  ({ id, name: id, host: `${id}.lan`, port: 22, username: "u", last_used_at }) as Connection;

const never = host("never");
const old = host("old", "2026-01-01T00:00:00Z");
const fresh = host("fresh", "2026-03-01T00:00:00Z");
const mid = host("mid", "2026-02-01T00:00:00Z");

test("recentlyUsed keeps used hosts only, newest first, up to the cap", () => {
  expect(recentlyUsed([never, old, fresh, mid]).map((c) => c.id)).toEqual(["fresh", "mid", "old"]);
  expect(recentlyUsed([never, old, fresh, mid], 2).map((c) => c.id)).toEqual(["fresh", "mid"]);
});

test("pinnedThenRecent puts pinned hosts first and can drop never-used ones", () => {
  const pinned = (c: Connection) => c.id === "old";
  expect(pinnedThenRecent([never, old, fresh, mid], pinned).map((c) => c.id)).toEqual(["old", "fresh", "mid", "never"]);
  expect(pinnedThenRecent([never, old, fresh, mid], pinned, true).map((c) => c.id)).toEqual(["old", "fresh", "mid"]);
});

test("partitionRecentHosts splits the recents off an empty query and skips them while searching", () => {
  const all = [never, old, fresh, mid];
  const idle = partitionRecentHosts(all, "", 2);
  expect(idle.recent.map((c) => c.id)).toEqual(["fresh", "mid"]);
  expect(idle.hosts.map((c) => c.id)).toEqual(["never", "old"]);

  const searching = partitionRecentHosts(all, "fre");
  expect(searching.recent).toEqual([]);
  expect(searching.hosts.map((c) => c.id)).toEqual(["fresh"]);
});

test("partitionRecentHosts matches the username too, ignoring case", () => {
  const pg = { ...host("db"), username: "postgres" };
  expect(partitionRecentHosts([fresh, pg], "POST").hosts.map((c) => c.id)).toEqual(["db"]);
});
