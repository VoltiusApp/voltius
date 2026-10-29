import { test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import type { SyncStatus } from "@/services/sync";
import { runManualSync } from "@/services/syncIntent";
import type { EffectiveSync } from "@/services/syncProviders";
import { EffectiveSyncIcon, SyncStatusIcon, effectiveSyncColor, useSyncMotion } from "./SyncStatusIcon";

vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));

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

const effective = (over: Partial<EffectiveSync>): EffectiveSync => ({
  configured: true, paused: false, status: "success", lastSync: null, error: null, errorSource: null, nearby: 0, ...over,
});

function EffectiveProbe({ sync }: { sync: EffectiveSync }) {
  const motion = useSyncMotion(sync.status);
  return <span data-color={effectiveSyncColor(sync, motion)}><EffectiveSyncIcon sync={sync} motion={motion} width={18} /></span>;
}

const renderEffective = (sync: EffectiveSync) => render(<EffectiveProbe sync={sync} />).container.firstChild as HTMLElement;

test("nearby devices with no cloud sync show a green wifi icon", () => {
  const el = renderEffective(effective({ configured: false, status: "idle", nearby: 2 }));
  expect(el.querySelector("[data-icon='lucide:wifi']")).not.toBeNull();
  expect(el.dataset.color).toBe("var(--t-status-connected)");
});

test("nearby devices with cloud sync offline show the wifi icon", () => {
  expect(renderEffective(effective({ status: "offline", nearby: 1 })).querySelector("[data-icon='lucide:wifi']")).not.toBeNull();
});

test("no nearby devices keeps cloud-off, and cloud sync that works keeps its own icon", () => {
  const off = renderEffective(effective({ configured: false, status: "idle" }));
  expect(off.querySelector("[data-icon='lucide:cloud-off']")).not.toBeNull();
  cleanup();
  expect(renderEffective(effective({ nearby: 2 })).querySelector("[data-icon='lucide:wifi']")).toBeNull();
});

test("nearby never upgrades an error", () => {
  const el = renderEffective(effective({ status: "error", error: "boom", nearby: 3 }));
  expect(el.querySelector("[data-icon='lucide:wifi']")).toBeNull();
  expect(el.dataset.color).toBe("var(--t-status-error)");
});
