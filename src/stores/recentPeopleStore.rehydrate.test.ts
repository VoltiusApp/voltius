import { test, expect, beforeEach, vi } from "vitest";

const STORAGE_KEY = "voltius-recent-people";

// zustand's `persist` runs `hydrate()` synchronously inside `create()` when
// storage is sync (localStorage): `toThenable` resolves a non-Promise result
// by calling `.then` inline rather than deferring to a microtask, so the
// entire hydrate chain — including any `onRehydrateStorage` callback — runs
// to completion before the module's own top-level `const` assignment
// finishes. A callback that closes over that `const` (as the old
// `onRehydrateStorage` implementation did) hits the temporal dead zone,
// throws, and is silently swallowed by `hydrate()`'s own `.catch`. This test
// exercises that exact path — real module-load hydration, not a manual
// `persist.rehydrate()` call after the module is already initialized, which
// is the one arrangement that cannot observe the bug.
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test("module-load hydration drops a legacy empty-handle row before first read", async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    state: {
      recent: [
        { user_id: "legacy", handle: "", last_invited_at: "2026-01-01T00:00:00.000Z" },
        { user_id: "ok", handle: "merry-quartz-2597", last_invited_at: "2026-01-02T00:00:00.000Z" },
      ],
      recentUpdatedAt: "2026-01-02T00:00:00.000Z",
    },
    // The pre-bump persisted shape: no explicit `version` option meant
    // zustand wrote `version: 0` on every real save.
    version: 0,
  }));

  const { useRecentPeopleStore } = await import("./recentPeopleStore");

  const { recent } = useRecentPeopleStore.getState();
  expect(recent.map((p) => p.user_id)).toEqual(["ok"]);
});
