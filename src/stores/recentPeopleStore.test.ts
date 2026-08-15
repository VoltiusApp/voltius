import { test, expect, beforeEach } from "vitest";
import { useRecentPeopleStore, MAX_RECENT } from "./recentPeopleStore";

const person = (id: string, at = "2026-08-15T00:00:00.000Z") => ({
  user_id: id, handle: `h-${id}`, display_name: id, last_invited_at: at,
});

beforeEach(() => useRecentPeopleStore.setState({ recent: [], recentUpdatedAt: new Date(0).toISOString() }));

test("remember puts the newest first and dedupes by user_id", () => {
  const s = useRecentPeopleStore.getState();
  s.remember(person("a", "2026-08-15T00:00:00.000Z"));
  s.remember(person("b", "2026-08-15T00:01:00.000Z"));
  s.remember(person("a", "2026-08-15T00:02:00.000Z"));
  const { recent } = useRecentPeopleStore.getState();
  expect(recent.map((p) => p.user_id)).toEqual(["a", "b"]);
  expect(recent[0].last_invited_at).toBe("2026-08-15T00:02:00.000Z");
});

test("the list is capped", () => {
  const s = useRecentPeopleStore.getState();
  for (let i = 0; i < MAX_RECENT + 5; i++) s.remember(person(`u${i}`, `2026-08-15T00:${String(i).padStart(2, "0")}:00.000Z`));
  expect(useRecentPeopleStore.getState().recent.length).toBe(MAX_RECENT);
});

test("forget removes one row and stamps the timestamp", () => {
  const s = useRecentPeopleStore.getState();
  s.remember(person("a"));
  const before = useRecentPeopleStore.getState().recentUpdatedAt;
  useRecentPeopleStore.getState().forget("a");
  expect(useRecentPeopleStore.getState().recent).toEqual([]);
  expect(useRecentPeopleStore.getState().recentUpdatedAt >= before).toBe(true);
});

test("no key material is ever stored", () => {
  useRecentPeopleStore.getState().remember({ ...person("a"), public_key: "leak" } as never);
  expect(JSON.stringify(useRecentPeopleStore.getState().recent)).not.toContain("leak");
});
