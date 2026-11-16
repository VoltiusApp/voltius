import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import MobileTerminalGestures from "./MobileTerminalGestures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/useTerminal", () => ({ focusSession: vi.fn(), getTerminalApi: () => null }));
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
afterEach(cleanup);

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
