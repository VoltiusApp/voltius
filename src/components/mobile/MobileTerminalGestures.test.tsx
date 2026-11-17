import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import MobileTerminalGestures from "./MobileTerminalGestures";
import { createNativeSelection, type NativeSelection } from "./nativeSelectionOverlay";
import { holdSessionFit } from "@/hooks/useTerminal";
import { hideAndroidKeyboard } from "@/services/androidKeyboard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/useTerminal", () => ({ focusSession: vi.fn(), getTerminalApi: () => null, holdSessionFit: vi.fn() }));
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
vi.mock("@/utils/platform", () => ({ useIsAndroid: () => true }));
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => {
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
