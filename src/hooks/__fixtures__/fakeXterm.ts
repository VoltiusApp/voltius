/**
 * Shared xterm doubles for the useTerminal tests.
 *
 * Every one of those tests needs the same stub of the slice of the Terminal and
 * addon surface useTerminal touches, so it lives here once: a new xterm API has
 * to be taught to a single fake rather than to each test file that mounts a
 * terminal.
 *
 * `vi.mock` factories are hoisted per file, so a test still declares its own
 * mocks — they just point at these classes:
 *
 *   vi.mock("@xterm/xterm", async () => ({
 *     Terminal: (await import("@/hooks/__fixtures__/fakeXterm")).FakeTerminal,
 *   }));
 *
 * The factory has to do that import itself — vi.mock is hoisted above any
 * top-level binding the file might otherwise share.
 */

/**
 * Handlers registered through `attachCustomKeyEventHandler`, keyed by terminal
 * id. Calling one is how a test delivers a key to the terminal that owns it.
 */
export const keyHandlers = new Map<string, (e: KeyboardEvent) => boolean>();

let seq = 0;

/** Terminal ids run `term-1`, `term-2`, ... in creation order. */
export class FakeTerminal {
  id = `term-${(seq += 1)}`;
  element: HTMLElement | null = null;
  options: Record<string, unknown> = {};
  cols = 80;
  rows = 24;
  modes = { applicationCursorKeysMode: false, mouseTrackingMode: "none" };
  buffer = {
    active: { length: 0, viewportY: 0, baseY: 0, cursorY: 0, type: "normal", getLine: () => null },
    onBufferChange: () => ({ dispose() {} }),
  };
  open(container: HTMLElement) {
    this.element = document.createElement("div");
    container.appendChild(this.element);
  }
  parser = { registerOscHandler: () => ({ dispose() {} }) };
  loadAddon() {}
  write() {}
  focus() {}
  getSelection() { return ""; }
  dispose() {}
  attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { keyHandlers.set(this.id, fn); }
  attachCustomWheelEventHandler() {}
  onData() { return { dispose() {} }; }
  onBinary() { return { dispose() {} }; }
  onResize() { return { dispose() {} }; }
  onScroll() { return { dispose() {} }; }
  onLineFeed() { return { dispose() {} }; }
  onRender() { return { dispose() {} }; }
  onWriteParsed() { return { dispose() {} }; }
  registerLinkProvider() { return { dispose() {} }; }
  registerDecoration() { return null; }
}

export class FakeFitAddon {
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 }; }
}

export class FakeWebglAddon {
  onContextLoss() { return { dispose() {} }; }
  dispose() {}
}

export class FakeWebLinksAddon {}

/**
 * Records searches instead of running them — the real addon reports hits back
 * through `onDidChangeResults`, which a stub cannot do, so `searches` is the
 * only observable that a find actually ran.
 */
export class FakeSearchAddon {
  static instances: FakeSearchAddon[] = [];
  searches: { direction: "next" | "prev"; query: string }[] = [];
  constructor() { FakeSearchAddon.instances.push(this); }
  findNext(query: string) { this.searches.push({ direction: "next", query }); return false; }
  findPrevious(query: string) { this.searches.push({ direction: "prev", query }); return false; }
  clearDecorations() {}
  onDidChangeResults() { return { dispose() {} }; }
}

/**
 * The handler the most recently created terminal registered. useTerminal caches
 * terminals by session id for the lifetime of the module, so a test that wants a
 * freshly constructed one has to use a session id no earlier test has mounted.
 */
export function lastKeyHandler(): (e: KeyboardEvent) => boolean {
  // Indexed rather than .at(-1): the project's tsconfig lib predates ES2022.
  const handlers = [...keyHandlers.values()];
  const last = handlers[handlers.length - 1];
  if (!last) throw new Error("no terminal registered a key handler — was one mounted?");
  return last;
}

/** Drop state a previous test left behind (ids restart at `term-1`). */
export function resetFakeXterm(): void {
  seq = 0;
  keyHandlers.clear();
  FakeSearchAddon.instances = [];
}
