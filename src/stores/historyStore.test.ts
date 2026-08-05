import { test, expect, beforeEach } from "vitest";
import { useHistoryStore } from "./historyStore";

const noop = async () => {};
const entry = (label: string) => ({ label, undo: noop, redo: noop });

beforeEach(() => {
  useHistoryStore.setState({
    past: [], future: [], bypassing: false, suppressing: false, suppressDepth: 0,
    canUndo: false, canRedo: false,
  });
});

test("withoutHistory suppresses pushes inside the window only", async () => {
  await useHistoryStore.getState().withoutHistory(async () => {
    useHistoryStore.getState().push(entry("inner"));
  });
  expect(useHistoryStore.getState().past).toHaveLength(0);
  useHistoryStore.getState().push(entry("after"));
  expect(useHistoryStore.getState().past).toHaveLength(1);
});

test("nested windows close independently", async () => {
  await useHistoryStore.getState().withoutHistory(async () => {
    await useHistoryStore.getState().withoutHistory(async () => {});
    expect(useHistoryStore.getState().suppressing).toBe(true);
    useHistoryStore.getState().push(entry("inner"));
  });
  expect(useHistoryStore.getState().suppressing).toBe(false);
  expect(useHistoryStore.getState().past).toHaveLength(0);
});

// The overlap a second paste on another page creates: an inner window that opens
// while an outer one is up and closes after it. Restoring a saved boolean here
// left `suppressing` true forever, silently dropping every later push.
test("a window that outlives an overlapping one still lifts suppression", async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = useHistoryStore.getState().withoutHistory(
    () => new Promise<void>((r) => { releaseFirst = r; }),
  );
  const second = useHistoryStore.getState().withoutHistory(
    () => new Promise<void>((r) => { releaseSecond = r; }),
  );

  releaseFirst();
  await first;
  expect(useHistoryStore.getState().suppressing).toBe(true);

  releaseSecond();
  await second;
  expect(useHistoryStore.getState().suppressing).toBe(false);

  useHistoryStore.getState().push(entry("later"));
  expect(useHistoryStore.getState().past).toHaveLength(1);
  expect(useHistoryStore.getState().canUndo).toBe(true);
});

test("a failing window still closes", async () => {
  await expect(
    useHistoryStore.getState().withoutHistory(async () => { throw new Error("boom"); }),
  ).rejects.toThrow("boom");
  expect(useHistoryStore.getState().suppressing).toBe(false);
  useHistoryStore.getState().push(entry("after"));
  expect(useHistoryStore.getState().past).toHaveLength(1);
});
