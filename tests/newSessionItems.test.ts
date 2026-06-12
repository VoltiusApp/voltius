import test from "node:test";
import assert from "node:assert/strict";
import { selectRecentHosts, partitionLauncherHosts } from "../src/components/layout/newSessionItems.ts";
import type { Connection } from "../src/types/index.ts";

function conn(over: Partial<Connection>): Connection {
  return {
    id: "id", name: "name", host: "host", port: 22, username: "root",
    auth_type: "password", tags: [], vault_id: "personal",
    created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z",
    last_used_at: null, clocks: {}, ...over,
  } as Connection;
}

test("selectRecentHosts: only last_used, excludes active, newest first, capped", () => {
  const cs = [
    conn({ id: "a", last_used_at: "2024-01-03T00:00:00Z" }),
    conn({ id: "b", last_used_at: "2024-01-05T00:00:00Z" }),
    conn({ id: "c", last_used_at: null }),
    conn({ id: "d", last_used_at: "2024-01-04T00:00:00Z" }),
  ];
  const recent = selectRecentHosts(cs, new Set(["d"]), 2);
  assert.deepEqual(recent.map((c) => c.id), ["b", "a"]);
});

test("selectRecentHosts: no cap returns all eligible", () => {
  const cs = [
    conn({ id: "a", last_used_at: "2024-01-01T00:00:00Z" }),
    conn({ id: "b", last_used_at: "2024-01-02T00:00:00Z" }),
  ];
  assert.deepEqual(selectRecentHosts(cs, new Set()).map((c) => c.id), ["b", "a"]);
});

test("partitionLauncherHosts: empty query splits recent (capped) and the rest", () => {
  const cs = [
    conn({ id: "a", last_used_at: "2024-01-03T00:00:00Z" }),
    conn({ id: "b", last_used_at: "2024-01-05T00:00:00Z" }),
    conn({ id: "c", last_used_at: null, name: "fresh" }),
  ];
  const { recent, hosts } = partitionLauncherHosts(cs, new Set(), "", 5);
  assert.deepEqual(recent.map((c) => c.id), ["b", "a"]);
  assert.deepEqual(hosts.map((c) => c.id), ["c"]);
});

test("partitionLauncherHosts: query filters by name/host/username, recent empty", () => {
  const cs = [
    conn({ id: "a", name: "web-01", host: "1.2.3.4", username: "root", last_used_at: "2024-01-01T00:00:00Z" }),
    conn({ id: "b", name: "db", host: "10.0.0.5", username: "postgres" }),
  ];
  const r = partitionLauncherHosts(cs, new Set(), "post", 5);
  assert.deepEqual(r.recent, []);
  assert.deepEqual(r.hosts.map((c) => c.id), ["b"]);

  const r2 = partitionLauncherHosts(cs, new Set(), "WEB", 5);
  assert.deepEqual(r2.hosts.map((c) => c.id), ["a"]);
});
