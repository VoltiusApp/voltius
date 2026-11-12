import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TabCloseControl } from "./TabCloseControl";
import { useLockNudgeStore } from "@/stores/lockNudgeStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";

const UNLOCK = "layout.titleBar.lock.unlockHint";
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }), initReactI18next: { type: "3rdParty", init: () => {} } }));

const session = (id: string, locked: boolean): TerminalSession => ({ id, connectionId: "c", connectionName: id, status: "connected", type: "ssh", locked });

function setup(lockedIds: string[], variant: "tab" | "pane" = "tab") {
  useSessionStore.setState({ sessions: [session("s1", lockedIds.includes("s1")), session("s2", lockedIds.includes("s2"))] });
  const onClose = vi.fn();
  render(<TabCloseControl variant={variant} sessionIds={["s1", "s2"]} closeTitle="Close tab" onClose={onClose} />);
  return { onClose };
}

const locked = (id: string) => useSessionStore.getState().sessions.find((s) => s.id === id)?.locked;

describe("TabCloseControl", () => {
  beforeEach(() => { vi.useFakeTimers(); useLockNudgeStore.setState({ nonce: 0, ids: [] }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  test("shows the lock when any of its sessions is locked, and clicking it unlocks them all", () => {
    const { onClose } = setup(["s2"]);
    fireEvent.click(screen.getByTitle(UNLOCK));
    expect(locked("s1")).toBe(false);
    expect(locked("s2")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("right after unlocking, the X ignores clicks for 450 ms", () => {
    const { onClose } = setup(["s1"]);
    fireEvent.click(screen.getByTitle(UNLOCK));
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.click(screen.getByTitle("Close tab"));
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(351); });
    fireEvent.click(screen.getByTitle("Close tab"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("a nudge for one of its sessions plays the wiggle", () => {
    setup(["s1"]);
    act(() => { useLockNudgeStore.getState().nudge(["s2"]); });
    expect(screen.getByTitle(UNLOCK).className).toContain("animate-tab-lock-wiggle");
  });

  test("a nudge for another session does not", () => {
    setup(["s1"]);
    act(() => { useLockNudgeStore.getState().nudge(["zz"]); });
    expect(screen.getByTitle(UNLOCK).className).not.toContain("animate-tab-lock-wiggle");
  });

  test("the tab X only shows on hover, the pane X always", () => {
    setup([], "tab");
    expect(screen.getByTitle("Close tab").className).toContain("opacity-0");
    cleanup();
    setup([], "pane");
    expect(screen.getByTitle("Close tab").className).not.toContain("opacity-0");
  });

  test("after unlocking and locking again, the closed padlock shows even though the pointer never left", () => {
    setup(["s1"]);
    const lock = screen.getByTitle(UNLOCK);
    fireEvent.mouseEnter(lock);
    fireEvent.click(lock);
    act(() => { useSessionStore.getState().setSessionsLocked(["s1"], true); });
    expect(screen.getByTitle(UNLOCK).innerHTML).not.toContain("lock-open");
  });

  test("double-clicking the lock does not reach the tab's own double-click", () => {
    const onParentDouble = vi.fn();
    useSessionStore.setState({ sessions: [session("s1", true)] });
    render(<div onDoubleClick={onParentDouble}><TabCloseControl variant="tab" sessionIds={["s1"]} closeTitle="Close tab" onClose={vi.fn()} /></div>);
    fireEvent.doubleClick(screen.getByTitle(UNLOCK));
    expect(onParentDouble).not.toHaveBeenCalled();
  });
});
