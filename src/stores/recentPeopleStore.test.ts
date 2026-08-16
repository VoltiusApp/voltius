import { test, expect, beforeEach } from "vitest";
import { useRecentPeopleStore, MAX_RECENT, type RecentPerson } from "./recentPeopleStore";
import { withRemoteApply } from "./remoteApplyGuard";

const person = (id: string, at = "2026-08-15T00:00:00.000Z") => ({
  user_id: id, handle: `h-${id}`, last_invited_at: at,
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

// replaceAll is the path that takes foreign data — the sync blob and the import
// UI — so it needs the projection more than remember does.
test("replaceAll strips fields remember would have dropped", () => {
  useRecentPeopleStore.getState().replaceAll([{ ...person("a"), public_key: "leak" }] as never);
  const { recent } = useRecentPeopleStore.getState();
  expect(JSON.stringify(recent)).not.toContain("leak");
  expect(Object.keys(recent[0]).sort()).toEqual(["handle", "last_invited_at", "user_id"]);
});

// A device that has not updated keeps writing display_name into the E2EE sync
// blob. project() runs on replaceAll — the path that takes the blob and the
// import UI — so the stale field is dropped on arrival and no migration is
// needed. See E4 in the design.
test("replaceAll drops a display_name carried by an older device's blob", () => {
  useRecentPeopleStore.getState().replaceAll([
    { user_id: "u1", handle: "merry-quartz-2597", last_invited_at: "2026-08-15T00:00:00.000Z",
      display_name: "ada" } as unknown as RecentPerson,
  ]);
  const [row] = useRecentPeopleStore.getState().recent;
  expect(row).toEqual({
    user_id: "u1",
    handle: "merry-quartz-2597",
    last_invited_at: "2026-08-15T00:00:00.000Z",
  });
  expect("display_name" in row).toBe(false);
});

// A peer device's synced list or an old export file can carry a pre-handle
// row with handle: "". replaceAll must filter it out, not just migrate().
test("replaceAll drops a row with an empty handle", () => {
  useRecentPeopleStore.getState().replaceAll([
    { user_id: "u1", handle: "", last_invited_at: "2026-08-15T00:00:00.000Z" },
    person("u2"),
  ]);
  const { recent } = useRecentPeopleStore.getState();
  expect(recent.map((p) => p.user_id)).toEqual(["u2"]);
});

test("replaceAll caps the list and rejects a non-array", () => {
  useRecentPeopleStore.getState().replaceAll(
    Array.from({ length: MAX_RECENT + 5 }, (_, i) => person(`u${i}`)),
  );
  expect(useRecentPeopleStore.getState().recent.length).toBe(MAX_RECENT);

  useRecentPeopleStore.getState().replaceAll({ not: "an array" } as never);
  expect(useRecentPeopleStore.getState().recent).toEqual([]);
});

test("an imported list is stamped, not left at the epoch", () => {
  const epoch = new Date(0).toISOString();
  useRecentPeopleStore.getState().replaceAll([person("a")]);
  expect(useRecentPeopleStore.getState().recentUpdatedAt > epoch).toBe(true);
});

test("a remotely applied list adopts the remote timestamp", async () => {
  const remoteAt = "2026-08-15T07:51:57.626Z";
  await withRemoteApply(remoteAt, async () => {
    useRecentPeopleStore.getState().replaceAll([person("a")]);
  });
  expect(useRecentPeopleStore.getState().recentUpdatedAt).toBe(remoteAt);
});

// The rehydration-drops-a-legacy-row case now lives in
// recentPeopleStore.rehydrate.test.ts, which exercises real module-load
// hydration rather than a manual persist.rehydrate() call after the module
// is already initialized — see that file for why the distinction matters.
