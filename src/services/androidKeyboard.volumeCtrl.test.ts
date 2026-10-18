// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ write: vi.fn(), invoke: vi.fn(async () => undefined) }));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/hooks/useTerminal", () => ({ writeToSession: h.write }));
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: vi.fn() }));
vi.mock("@/services/account", () => ({ getAppLock: async () => null, setAppLock: async () => {} }));

import { showAndroidKeyboard } from "./androidKeyboard";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { initialLatch } from "@/stores/modifierLatchCore";

const w = window as unknown as { __voltiusTermInput: (t: string, ctrl?: boolean) => void };

beforeEach(() => {
  vi.clearAllMocks();
  useModifierLatchStore.setState(initialLatch);
  useToggleSettingsStore.setState({ values: {} });
  showAndroidKeyboard("s1");
});

test("a char typed while Volume Down is held is sent with Ctrl", () => {
  w.__voltiusTermInput("c", true);
  expect(h.write).toHaveBeenCalledWith("s1", "\x03");
});

test("a char typed without Volume Down passes through", () => {
  w.__voltiusTermInput("c", false);
  expect(h.write).toHaveBeenCalledWith("s1", "c");
});

test("Volume Down combines with a latched Alt and consumes the latch", () => {
  useModifierLatchStore.getState().tap("alt");
  w.__voltiusTermInput("c", true);
  expect(h.write).toHaveBeenCalledWith("s1", "\x1b\x03");
  expect(useModifierLatchStore.getState().alt).toBe("off");
});

test("multi-char IME commits are never modified", () => {
  w.__voltiusTermInput("ls", true);
  expect(h.write).toHaveBeenCalledWith("s1", "ls");
});

test("showing the keyboard tells native whether Volume Down acts as Ctrl", () => {
  expect(h.invoke).toHaveBeenCalledWith("terminal_show_keyboard", { volumeCtrl: false });
  useToggleSettingsStore.getState().set("volume-down-ctrl", true);
  showAndroidKeyboard("s1");
  expect(h.invoke).toHaveBeenLastCalledWith("terminal_show_keyboard", { volumeCtrl: true });
});
