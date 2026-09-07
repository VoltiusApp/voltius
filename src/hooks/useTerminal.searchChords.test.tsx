import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { getTerminalSearchController, useTerminal } from "@/hooks/useTerminal";
import { FakeSearchAddon, lastKeyHandler, resetFakeXterm } from "@/hooks/__fixtures__/fakeXterm";

// vi.mock is hoisted above every top-level binding, so each factory has to
// import the fixture itself rather than share a helper.
vi.mock("@xterm/xterm", async () => ({ Terminal: (await import("@/hooks/__fixtures__/fakeXterm")).FakeTerminal }));
vi.mock("@xterm/addon-fit", async () => ({ FitAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeFitAddon }));
vi.mock("@xterm/addon-webgl", async () => ({ WebglAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebglAddon }));
vi.mock("@xterm/addon-web-links", async () => ({ WebLinksAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebLinksAddon }));
vi.mock("@xterm/addon-search", async () => ({ SearchAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeSearchAddon }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/services/ssh", () => ({
  sshSendInput: vi.fn(), sshResize: vi.fn(),
  onSshOutput: vi.fn(async () => () => {}), onSshClosed: vi.fn(async () => () => {}), onSshCwd: vi.fn(async () => () => {}),
}));
vi.mock("@/services/local", () => ({
  localSendInput: vi.fn(), localResize: vi.fn(), localReady: vi.fn(async () => {}),
  onLocalOutput: vi.fn(async () => () => {}), onLocalClosed: vi.fn(async () => () => {}),
}));
vi.mock("@/services/serial", () => ({
  serialWrite: vi.fn(), onSerialOutput: vi.fn(async () => () => {}), onSerialClosed: vi.fn(async () => () => {}),
}));
// Returning null keeps the clipboard out of the way: useTerminal forwards every
// key to it first and honours any non-null verdict.
vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: () => ({ handleKeyEvent: () => null, dispose() {} }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function Harness({ sessionId }: { sessionId: string }) {
  const { attach } = useTerminal({ sessionId, sessionType: "local" });
  return <div data-testid="host" ref={attach} />;
}

const ctrlG = (type: "keydown" | "keyup", shiftKey = false) =>
  new KeyboardEvent(type, { key: shiftKey ? "G" : "g", ctrlKey: true, shiftKey });

const ctrlF = () => new KeyboardEvent("keydown", { key: "f", ctrlKey: true });

/** Both spies on one event, so a claim can be asserted as a pair. */
function watchClaim(e: KeyboardEvent) {
  return {
    prevented: vi.spyOn(e, "preventDefault"),
    stopped: vi.spyOn(e, "stopPropagation"),
  };
}

describe("terminal search chords", () => {
  beforeEach(() => {
    resetFakeXterm();
  });

  // Returning false from the custom key handler makes xterm skip the key: it
  // encodes nothing and writes nothing to the PTY. With the search widget shut
  // that starved the shell of ^G — readline's abort, and the only way out of a
  // Ctrl+R reverse-i-search (#208).
  it("hands Ctrl+G to xterm while the search widget is closed", () => {
    render(<Harness sessionId="ctrl-g-closed" />);
    const handler = lastKeyHandler();

    expect(handler(ctrlG("keydown"))).toBe(true);
    expect(handler(ctrlG("keyup"))).toBe(true);
    expect(handler(ctrlG("keydown", true))).toBe(true);
  });

  it("drives an open search widget instead, and keeps the key from the shell", () => {
    render(<Harness sessionId="ctrl-g-open" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-open")!;
    search.open();
    // runSearch bails on an empty query, so a find is only observable with one.
    search.setQuery("needle");
    const addon = FakeSearchAddon.instances[FakeSearchAddon.instances.length - 1];
    addon.searches.length = 0;

    expect(handler(ctrlG("keydown"))).toBe(false);
    expect(handler(ctrlG("keydown", true))).toBe(false);
    expect(addon.searches).toEqual([
      { direction: "next", query: "needle" },
      { direction: "prev", query: "needle" },
    ]);

    // The chord stays consumed on the way back up, without moving the hit again.
    expect(handler(ctrlG("keyup"))).toBe(false);
    expect(addon.searches).toHaveLength(2);
  });

  // xterm returns early on a false verdict without cancelling the event, so a
  // chord the handler claims still bubbles to useKeyboard's window listener.
  // Ctrl+F and Ctrl+G are the two branches that sit above that listener's
  // isInput guard, so they are the two it would otherwise run a second time —
  // reopening the widget, or moving two hits per press.
  it("claims Ctrl+G so the window listener cannot move the hit twice", () => {
    render(<Harness sessionId="ctrl-g-claims" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-claims")!;

    const open = ctrlG("keydown");
    const claim = watchClaim(open);
    search.open();
    expect(handler(open)).toBe(false);
    expect(claim.stopped).toHaveBeenCalled();
    expect(claim.prevented).toHaveBeenCalled();

    // Closed, the shell owns the chord: xterm cancels it on the way out, so the
    // handler must leave the event alone rather than swallow it here.
    const closed = ctrlG("keydown");
    const passThrough = watchClaim(closed);
    search.close();
    expect(handler(closed)).toBe(true);
    expect(passThrough.stopped).not.toHaveBeenCalled();
    expect(passThrough.prevented).not.toHaveBeenCalled();
  });

  it("claims Ctrl+F, so only the terminal widget opens", () => {
    render(<Harness sessionId="ctrl-f-claims" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-f-claims")!;

    const e = ctrlF();
    const claim = watchClaim(e);
    expect(handler(e)).toBe(false);
    expect(search.getSnapshot().open).toBe(true);
    expect(claim.stopped).toHaveBeenCalled();
    expect(claim.prevented).toHaveBeenCalled();
  });

  it("goes back to the shell once the widget closes", () => {
    render(<Harness sessionId="ctrl-g-reclosed" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-reclosed")!;
    search.open();
    expect(handler(ctrlG("keydown"))).toBe(false);

    search.close();
    expect(handler(ctrlG("keydown"))).toBe(true);
  });
});
