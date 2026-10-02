import { test, expect, vi } from "vitest";
import { TeamVaultRefreshQueue } from "./teamVaultRefresh";

function deferredFetch() {
  const releases: (() => void)[] = [];
  const refresh = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve); }));
  const releaseNext = async () => {
    releases.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { refresh, releaseNext };
}

test("a request during a pending fetch runs exactly one follow-up fetch", async () => {
  const queue = new TeamVaultRefreshQueue();
  const { refresh, releaseNext } = deferredFetch();

  const first = queue.run("t1", {}, refresh);
  const second = queue.run("t1", {}, refresh);
  expect(refresh).toHaveBeenCalledTimes(1);

  await releaseNext();
  expect(refresh).toHaveBeenCalledTimes(2);
  await releaseNext();
  await Promise.all([first, second]);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("several requests during one fetch share a single follow-up", async () => {
  const queue = new TeamVaultRefreshQueue();
  const { refresh, releaseNext } = deferredFetch();

  queue.run("t1", {}, refresh);
  const followUps = [queue.run("t1", {}, refresh), queue.run("t1", {}, refresh), queue.run("t1", {}, refresh)];

  await releaseNext();
  await releaseNext();
  await Promise.all(followUps);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("a follow-up still runs when the pending fetch fails", async () => {
  const queue = new TeamVaultRefreshQueue();
  const refresh = vi.fn()
    .mockImplementationOnce(() => Promise.reject(new Error("boom")))
    .mockImplementationOnce(() => Promise.resolve());

  const first = queue.run("t1", {}, refresh);
  const second = queue.run("t1", {}, refresh);

  await expect(first).rejects.toThrow("boom");
  await second;
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("a request after the fetch settled starts a new fetch", async () => {
  const queue = new TeamVaultRefreshQueue();
  const refresh = vi.fn(() => Promise.resolve());

  await queue.run("t1", {}, refresh);
  await queue.run("t1", {}, refresh);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("a foreground request joining a queued background follow-up runs it in the foreground", async () => {
  const queue = new TeamVaultRefreshQueue();
  const { refresh, releaseNext } = deferredFetch();

  queue.run("t1", { background: true }, refresh);
  queue.run("t1", { background: true }, refresh);
  const foreground = queue.run("t1", {}, refresh);

  await releaseNext();
  await releaseNext();
  await foreground;
  expect(refresh).toHaveBeenNthCalledWith(1, { background: true });
  expect(refresh).toHaveBeenNthCalledWith(2, { background: false });
});

test("a background request joining a queued foreground follow-up keeps it in the foreground", async () => {
  const queue = new TeamVaultRefreshQueue();
  const { refresh, releaseNext } = deferredFetch();

  queue.run("t1", { background: true }, refresh);
  const foreground = queue.run("t1", {}, refresh);
  queue.run("t1", { background: true }, refresh);

  await releaseNext();
  await releaseNext();
  await foreground;
  expect(refresh).toHaveBeenNthCalledWith(2, {});
});
