import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import MobileTerminalGestures from "./MobileTerminalGestures";
import { createNativeSelection, type NativeSelection } from "./nativeSelectionOverlay";
import { holdSessionFit } from "@/hooks/useTerminal";
import { hideAndroidKeyboard, showAndroidKeyboard } from "@/services/androidKeyboard";
import { appToast } from "@/services/appToast";
import { useTeamSessionStore, type MultiplayerSessionState } from "@/stores/teamSessionStore";
import { sendSpecialKey } from "@/services/terminalInput";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
const term = vi.hoisted(() => ({ api: null as null | Record<string, unknown> }));
vi.mock("@/hooks/useTerminal", () => ({
  focusSession: vi.fn(), getTerminalApi: () => term.api, holdSessionFit: vi.fn(),
  getScrollOffset: () => 0, subscribeTerminalScroll: () => () => {},
}));
vi.mock("./nativeSelectionOverlay", async (actual) => {
  const mod = await actual<typeof import("./nativeSelectionOverlay")>();
  return { ...mod, createNativeSelection: vi.fn(mod.createNativeSelection) };
});
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: vi.fn() }));
vi.mock("@/services/androidKeyboard", () => ({
  showAndroidKeyboard: vi.fn(),
  hideAndroidKeyboard: vi.fn(),
  setAndroidKeyboardTarget: vi.fn(),
  setSelectionTouchFeed: vi.fn(),
}));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<typeof import("@/utils/platform")>()), useIsAndroid: () => true }));
vi.mock("@/services/appToast", () => ({ appToast: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  term.api = null;
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function mount() {
  const { getByTestId } = render(
    <div data-testid="session">
      <div data-testid="terminal" />
      <MobileTerminalGestures sessionId="s1" active />
    </div>,
  );
  const paste = vi.fn();
  getByTestId("terminal").addEventListener("contextmenu", paste);
  const overlay = getByTestId("session").querySelector<HTMLElement>("[data-native-selection]")!;
  return { terminal: getByTestId("terminal"), overlay, paste };
}

describe("MobileTerminalGestures long-press contextmenu", () => {
  test("never reaches the terminal container's paste handler", () => {
    const { terminal, paste } = mount();
    expect(fireEvent.contextMenu(terminal)).toBe(false);
    expect(paste).not.toHaveBeenCalled();
  });

  test("keeps its default on the selection overlay so the WebView can start a native selection", () => {
    const { overlay } = mount();
    expect(fireEvent.contextMenu(overlay)).toBe(true);
  });
});

describe("MobileTerminalGestures long-press on text with the keyboard up", () => {
  function pressText() {
    let onSelecting: ((on: boolean) => void) | undefined;
    let selecting = false;
    vi.mocked(createNativeSelection).mockImplementationOnce((_host, _term, cb) => {
      onSelecting = cb;
      const fake: NativeSelection = {
        arm() {}, disarm() {}, hitsText: () => true, isSelecting: () => selecting, finger() {}, dispose() {},
      };
      return fake;
    });
    vi.useFakeTimers();
    const { terminal } = mount();
    fireEvent.touchStart(terminal, { touches: [{ clientX: 10, clientY: 10 }] });
    vi.advanceTimersByTime(400);
    return {
      lift: () => fireEvent.touchEnd(terminal, { changedTouches: [{ clientX: 10, clientY: 10 }] }),
      select: (on: boolean) => { selecting = on; onSelecting?.(on); },
    };
  }

  test("holds the terminal grid while the keyboard closes so the pressed text stays under the finger", () => {
    pressText();
    expect(holdSessionFit).toHaveBeenLastCalledWith("s1", true);
    expect(vi.mocked(holdSessionFit).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(hideAndroidKeyboard).mock.invocationCallOrder[0]);
  });

  test("keeps the hold through the selection and releases it when the selection ends", () => {
    const press = pressText();
    press.select(true);
    press.lift();
    expect(holdSessionFit).toHaveBeenLastCalledWith("s1", true);
    press.select(false);
    expect(holdSessionFit).toHaveBeenLastCalledWith("s1", false);
  });

  test("releases the hold when the finger lifts before a selection starts", () => {
    pressText().lift();
    expect(holdSessionFit).toHaveBeenLastCalledWith("s1", false);
  });
});

function fakeApi(opts: { alternate: boolean; mouse: boolean }) {
  const screen = document.createElement("div");
  screen.getBoundingClientRect = () => ({ height: 240 } as DOMRect);
  const wheels: WheelEvent[] = [];
  screen.addEventListener("wheel", (e) => wheels.push(e as WheelEvent));
  const scrollLines = vi.fn();
  vi.mocked(createNativeSelection).mockImplementationOnce(() => ({
    arm() {}, disarm() {}, hitsText: () => false, isSelecting: () => false, finger() {}, dispose() {},
  }));
  term.api = {
    rows: () => 24, screenEl: () => screen, scrollLines,
    alternateScreen: () => opts.alternate, mouseMode: () => opts.mouse,
  };
  return { wheels, scrollLines };
}

const at = (y: number, x = 100) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });

function drag(el: HTMLElement, fromY: number, toY: number) {
  fireEvent.touchStart(el, at(fromY));
  fireEvent.touchMove(el, at(fromY + (toY - fromY) / 2));
  fireEvent.touchMove(el, at(toY));
  fireEvent.touchEnd(el, at(toY));
}

describe("MobileTerminalGestures drags", () => {
  test("a drag in the normal buffer scrolls the scrollback", () => {
    const { wheels, scrollLines } = fakeApi({ alternate: false, mouse: false });
    const { terminal } = mount();
    drag(terminal, 100, 160);
    expect(scrollLines).toHaveBeenCalled();
    expect(wheels).toHaveLength(0);
  });

  test("a drag in a full-screen app becomes one wheel notch per line, up for a downward drag", () => {
    const { wheels, scrollLines } = fakeApi({ alternate: true, mouse: true });
    const { terminal } = mount();
    drag(terminal, 100, 160);
    expect(scrollLines).not.toHaveBeenCalled();
    expect(wheels.length).toBeGreaterThan(0);
    expect(wheels.every((w) => w.deltaY === -10)).toBe(true);
  });
});

describe("MobileTerminalGestures sideways drags", () => {
  const two = (y: number, x1: number, x2: number) => {
    const touches = [{ clientX: x1, clientY: y }, { clientX: x2, clientY: y }];
    return { touches, changedTouches: touches };
  };
  const q = () => window.innerWidth / 4;

  test("one finger in a full-screen app sends no keys (it stays the session swipe)", () => {
    fakeApi({ alternate: true, mouse: false });
    const { terminal } = mount();
    fireEvent.touchStart(terminal, at(100, 600));
    fireEvent.touchMove(terminal, at(100, 600 - q()));
    fireEvent.touchEnd(terminal, at(100, 600 - q()));
    expect(sendSpecialKey).not.toHaveBeenCalled();
  });

  test("two fingers sliding left send Right, and sliding back sends Left", () => {
    fakeApi({ alternate: false, mouse: false });
    const { terminal } = mount();
    fireEvent.touchStart(terminal, two(100, 500, 700));
    fireEvent.touchMove(terminal, two(100, 500 - q(), 700 - q()));
    fireEvent.touchMove(terminal, two(100, 500, 700));
    fireEvent.touchEnd(terminal, { touches: [], changedTouches: two(100, 500, 700).touches });
    expect(vi.mocked(sendSpecialKey).mock.calls.map((c) => c[1])).toEqual(["Right", "Left"]);
  });

  test("two fingers spreading apart zoom and send no keys", () => {
    fakeApi({ alternate: false, mouse: false });
    const { terminal } = mount();
    fireEvent.touchStart(terminal, two(100, 500, 600));
    fireEvent.touchMove(terminal, two(100, 400, 700));
    fireEvent.touchEnd(terminal, { touches: [], changedTouches: two(100, 400, 700).touches });
    expect(sendSpecialKey).not.toHaveBeenCalled();
  });
});

describe("MobileTerminalGestures double tap", () => {
  const doubleTap = (el: HTMLElement) => {
    for (let i = 0; i < 2; i++) { fireEvent.touchStart(el, at(100)); fireEvent.touchEnd(el, at(100)); }
  };

  test("sends Tab in a plain shell", () => {
    fakeApi({ alternate: false, mouse: false });
    const { terminal } = mount();
    doubleTap(terminal);
    expect(sendSpecialKey).toHaveBeenCalledWith("s1", "Tab", expect.anything());
  });

  test("is left to a mouse-reporting app as a double click", () => {
    fakeApi({ alternate: true, mouse: true });
    const { terminal } = mount();
    doubleTap(terminal);
    expect(sendSpecialKey).not.toHaveBeenCalled();
  });
});

describe("MobileTerminalGestures tap on a shared terminal", () => {
  const tap = (el: HTMLElement) => { fireEvent.touchStart(el, at(100)); fireEvent.touchEnd(el, at(100)); };
  const guest = (controlHolder: string) => useTeamSessionStore.setState({
    connections: { s1: { role: "guest", myUserId: "me", controlHolder } as MultiplayerSessionState },
  });
  afterEach(() => useTeamSessionStore.setState({ connections: {} }));

  test("explains instead of raising the keyboard while I only watch", () => {
    fakeApi({ alternate: false, mouse: false });
    guest("host");
    tap(mount().terminal);
    expect(showAndroidKeyboard).not.toHaveBeenCalled();
    expect(appToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  test("raises the keyboard once I hold control", () => {
    fakeApi({ alternate: false, mouse: false });
    guest("me");
    tap(mount().terminal);
    expect(showAndroidKeyboard).toHaveBeenCalledWith("s1");
    expect(appToast).not.toHaveBeenCalled();
  });
});
