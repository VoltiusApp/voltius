import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginAPI, PluginManifest } from "./api";

type CloseHandler = (event: { preventDefault: () => void }) => unknown;

const { closeHandlers, hide, invoke, isVisible } = vi.hoisted(() => ({
  closeHandlers: [] as CloseHandler[],
  hide: vi.fn(() => Promise.resolve()),
  invoke: vi.fn(() => Promise.resolve()),
  isVisible: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    hide,
    isVisible,
    onCloseRequested: (cb: CloseHandler) => {
      closeHandlers.push(cb);
      return Promise.resolve(() => {});
    },
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function manifest(id: string): PluginManifest {
  return { id, name: id, version: "1", permissions: [] };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function fireClose(): Promise<void> {
  const handler = closeHandlers[closeHandlers.length - 1];
  if (!handler) throw new Error("no close handler registered");
  await handler({ preventDefault: () => {} });
}

/** Registers `cb` as a quit hook and returns the unsubscribe. */
async function registerQuitHook(cb: () => void | Promise<void>): Promise<() => void> {
  let api: PluginAPI | null = null;
  loadPlugin(manifest("q"), (a) => { api = a; return () => {}; }, true, false);
  const off = api!.lifecycle.onBeforeQuit(cb);
  await flush();
  return off;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  hide.mockClear();
  invoke.mockClear();
  isVisible.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  try { unloadPlugin("q"); } catch { /* noop */ }
});

describe("the close handler", () => {
  test("hides the window before waiting on a quit hook", async () => {
    let hiddenBeforeHook = false;
    const off = await registerQuitHook(() => { hiddenBeforeHook = hide.mock.calls.length > 0; });

    await fireClose();

    expect(hiddenBeforeHook).toBe(true);
    expect(invoke).toHaveBeenCalledWith("force_quit");
    off();
  });

  test("leaves the window up when no plugin registered a quit hook", async () => {
    const off = await registerQuitHook(() => {});
    off();

    await fireClose();

    expect(hide).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("force_quit");
  });

  test("still exits when a quit hook throws synchronously", async () => {
    const off = await registerQuitHook(() => { throw new Error("boom"); });

    await fireClose();

    expect(invoke).toHaveBeenCalledWith("force_quit");
    off();
  });

  test("exits on the cap when a quit hook never settles, and only once", async () => {
    const off = await registerQuitHook(() => new Promise<void>(() => {}));

    const closed = fireClose();
    await vi.advanceTimersByTimeAsync(5000);
    await closed;
    expect(invoke).toHaveBeenCalledWith("force_quit");

    // The fallback exit must have been disarmed by the normal path.
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).toHaveBeenCalledTimes(1);
    off();
  });
});
