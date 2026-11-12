import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TabCloseControl } from "./TabCloseControl";
import { useLockNudgeStore } from "@/stores/lockNudgeStore";

const UNLOCK = "layout.titleBar.lock.unlockHint";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

function setup(locked: boolean, variant: "tab" | "pane" = "tab") {
  const onClose = vi.fn();
  const onUnlock = vi.fn();
  const view = render(
    <TabCloseControl variant={variant} locked={locked} lockIds={["s1", "s2"]} closeTitle="Close tab" onClose={onClose} onUnlock={onUnlock} />,
  );
  return { onClose, onUnlock, view };
}

describe("TabCloseControl", () => {
  beforeEach(() => { vi.useFakeTimers(); useLockNudgeStore.setState({ nonce: 0, ids: [] }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  test("a locked tab shows the lock, and clicking it unlocks instead of closing", () => {
    const { onClose, onUnlock } = setup(true);
    fireEvent.click(screen.getByTitle(UNLOCK));
    expect(onUnlock).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("right after unlocking, the X ignores clicks for 450 ms", () => {
    const { onClose, view } = setup(true);
    fireEvent.click(screen.getByTitle(UNLOCK));
    view.rerender(<TabCloseControl variant="tab" locked={false} lockIds={["s1", "s2"]} closeTitle="Close tab" onClose={onClose} onUnlock={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.click(screen.getByTitle("Close tab"));
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(351); });
    fireEvent.click(screen.getByTitle("Close tab"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("a nudge for one of its sessions plays the wiggle", () => {
    setup(true);
    act(() => { useLockNudgeStore.getState().nudge(["s2"]); });
    expect(screen.getByTitle(UNLOCK).className).toContain("animate-tab-lock-wiggle");
  });

  test("a nudge for another session does not", () => {
    setup(true);
    act(() => { useLockNudgeStore.getState().nudge(["zz"]); });
    expect(screen.getByTitle(UNLOCK).className).not.toContain("animate-tab-lock-wiggle");
  });

  test("the tab X only shows on hover, the pane X always", () => {
    setup(false, "tab");
    expect(screen.getByTitle("Close tab").className).toContain("opacity-0");
    cleanup();
    setup(false, "pane");
    expect(screen.getByTitle("Close tab").className).not.toContain("opacity-0");
  });
});
