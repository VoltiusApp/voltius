// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ write: vi.fn(), key: vi.fn(), invoke: vi.fn(async () => undefined) }));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/hooks/useTerminal", () => ({ writeToSession: h.write }));
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: h.key }));
vi.mock("@/services/account", () => ({ getAppLock: async () => null, setAppLock: async () => {} }));

import { showAndroidKeyboard } from "./androidKeyboard";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { initialLatch } from "@/stores/modifierLatchCore";

type Held = { ctrl?: boolean; alt?: boolean; shift?: boolean };
const w = window as unknown as {
  __voltiusTermInput: (t: string, held?: Held) => void;
  __voltiusTermKey: (k: string, held?: Held) => void;
};

beforeEach(() => {
  vi.clearAllMocks();
  useModifierLatchStore.setState(initialLatch);
  useToggleSettingsStore.setState({ values: {} });
  showAndroidKeyboard("s1");
});

test("a char typed while Volume Down is held is sent with Ctrl", () => {
  w.__voltiusTermInput("c", { ctrl: true });
  expect(h.write).toHaveBeenCalledWith("s1", "\x03");
});

test("a char typed without Volume Down passes through", () => {
  w.__voltiusTermInput("c", {});
  expect(h.write).toHaveBeenCalledWith("s1", "c");
});

test("Volume Down combines with a latched Alt and consumes the latch", () => {
  useModifierLatchStore.getState().tap("alt");
  w.__voltiusTermInput("c", { ctrl: true });
  expect(h.write).toHaveBeenCalledWith("s1", "\x1b\x03");
  expect(useModifierLatchStore.getState().alt).toBe("off");
});

test("multi-char IME commits are never modified", () => {
  w.__voltiusTermInput("ls", { ctrl: true });
  expect(h.write).toHaveBeenCalledWith("s1", "ls");
});

test("showing the keyboard tells native whether Volume Down acts as Ctrl", () => {
  expect(h.invoke).toHaveBeenCalledWith("terminal_show_keyboard", { volumeCtrl: false });
  useToggleSettingsStore.getState().set("volume-down-ctrl", true);
  showAndroidKeyboard("s1");
  expect(h.invoke).toHaveBeenLastCalledWith("terminal_show_keyboard", { volumeCtrl: true });
});

test("a latched Alt reaches Backspace from the keyboard and is consumed", () => {
  useModifierLatchStore.getState().tap("alt");
  w.__voltiusTermKey("Backspace");
  expect(h.key).toHaveBeenCalledWith("s1", "Backspace", { ctrl: false, alt: true, shift: false });
  expect(useModifierLatchStore.getState().alt).toBe("off");
});

test("Volume Down held while pressing a keyboard key sends it with Ctrl", () => {
  w.__voltiusTermKey("Backspace", { ctrl: true });
  expect(h.key).toHaveBeenCalledWith("s1", "Backspace", { ctrl: true, alt: false, shift: false });
});

test("unknown key names from the native side are dropped", () => {
  w.__voltiusTermKey("Pause");
  expect(h.key).not.toHaveBeenCalled();
});

test("a hardware Ctrl+Left reaches the session as Ctrl+Left", () => {
  w.__voltiusTermKey("Left", { ctrl: true, alt: false, shift: false });
  expect(h.key).toHaveBeenCalledWith("s1", "Left", { ctrl: true, alt: false, shift: false });
});

test("hardware Shift+Tab and F-keys are accepted", () => {
  w.__voltiusTermKey("Tab", { shift: true });
  w.__voltiusTermKey("F5", {});
  expect(h.key).toHaveBeenNthCalledWith(1, "s1", "Tab", { ctrl: false, alt: false, shift: true });
  expect(h.key).toHaveBeenNthCalledWith(2, "s1", "F5", { ctrl: false, alt: false, shift: false });
});

test("a hardware Alt+letter sends ESC and the letter", () => {
  w.__voltiusTermInput("b", { ctrl: false, alt: true, shift: false });
  expect(h.write).toHaveBeenCalledWith("s1", "\x1bb");
});

test("held and latched modifiers combine", () => {
  useModifierLatchStore.getState().tap("ctrl");
  w.__voltiusTermKey("Right", { alt: true });
  expect(h.key).toHaveBeenCalledWith("s1", "Right", { ctrl: true, alt: true, shift: false });
});
