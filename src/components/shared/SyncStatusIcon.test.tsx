import { test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import type { SyncStatus } from "@/services/sync";
import { runManualSync } from "@/services/syncIntent";
import { SyncStatusIcon, useSyncMotion } from "./SyncStatusIcon";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe({ status }: { status: SyncStatus }) {
  return <SyncStatusIcon sync={useSyncMotion(status)} width={18} />;
}

function mount(status: SyncStatus) {
  const view = render(<Probe status={status} />);
  const icon = () => view.container.firstChild as HTMLElement;
  return {
    icon,
    set: (next: SyncStatus) => view.rerender(<Probe status={next} />),
    endTurn: () => {
      const arc = icon().querySelector("[data-arc]")!;
      // jsdom has no AnimationEvent, so React listens for the webkit-prefixed name.
      for (const type of ["animationiteration", "webkitAnimationIteration"]) {
        fireEvent(arc, new Event(type, { bubbles: true }));
      }
    },
  };
}

function startManualSync() {
  let finish!: () => void;
  act(() => { void runManualSync(() => new Promise<void>((resolve) => { finish = resolve; })); });
  return async () => { await act(async () => finish()); };
}

test("a background sync that ends within the delay neither moves nor recolours the icon", () => {
  const view = mount("success");
  view.set("syncing");
  act(() => vi.advanceTimersByTime(399));
  expect(view.icon().dataset.motion).toBe("none");
  expect(view.icon().dataset.status).toBe("success");
  view.set("success");
  act(() => vi.advanceTimersByTime(1000));
  expect(view.icon().dataset.motion).toBe("none");
});

test("a slow background sync breathes and stops the moment the sync ends", () => {
  const view = mount("success");
  view.set("syncing");
  act(() => vi.advanceTimersByTime(400));
  expect(view.icon().dataset.motion).toBe("breathe");
  expect(view.icon().dataset.status).toBe("syncing");
  view.set("error");
  expect(view.icon().dataset.motion).toBe("none");
  expect(view.icon().dataset.status).toBe("error");
});

test("a manual sync shows the arc at once and lets it finish its turn", async () => {
  const view = mount("success");
  const finish = startManualSync();
  view.set("syncing");
  expect(view.icon().dataset.motion).toBe("arc");
  view.endTurn();
  expect(view.icon().dataset.motion).toBe("arc");

  view.set("success");
  await finish();
  expect(view.icon().dataset.motion).toBe("arc");
  expect(view.icon().dataset.status).toBe("syncing");
  view.endTurn();
  expect(view.icon().dataset.motion).toBe("none");
  expect(view.icon().dataset.status).toBe("success");
});

test("the arc still stops within one turn when no animation event arrives", async () => {
  const view = mount("success");
  const finish = startManualSync();
  view.set("syncing");
  view.set("success");
  await finish();
  act(() => vi.advanceTimersByTime(750));
  expect(view.icon().dataset.motion).toBe("none");
});

test("asking for a sync during a background one turns the breath into the arc", async () => {
  const view = mount("success");
  view.set("syncing");
  act(() => vi.advanceTimersByTime(400));
  const finish = startManualSync();
  expect(view.icon().dataset.motion).toBe("arc");
  await finish();
  expect(view.icon().dataset.motion).toBe("arc");
});

test("the first sync after launch rests on the plain cloud until it has a result", () => {
  const view = mount("syncing");
  expect(view.icon().dataset.motion).toBe("none");
  expect(view.icon().dataset.status).toBe("idle");
});
