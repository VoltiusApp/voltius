// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ write: vi.fn(), invoke: vi.fn(async () => undefined) }));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/hooks/useTerminal", () => ({ writeToSession: h.write }));
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: vi.fn() }));
vi.mock("@/stores/modifierLatchStore", () => ({ consumeLatchForChar: () => null }));
vi.mock("@/services/account", () => ({ getAppLock: async () => null, setAppLock: async () => {} }));

import { showAndroidKeyboard } from "./androidKeyboard";
import { useAppLockStore } from "@/stores/appLockStore";

const w = window as unknown as { __voltiusTermInput: (t: string) => void; __voltiusTermKey: (k: string) => void };

beforeEach(() => {
  vi.clearAllMocks();
  useAppLockStore.setState({ kind: null });
  showAndroidKeyboard("s1");
});

test("native keyboard input reaches the session when unlocked", () => {
  w.__voltiusTermInput("a");
  expect(h.write).toHaveBeenCalledWith("s1", "a");
});

test("native keyboard input never reaches the session behind the lock screen", () => {
  useAppLockStore.setState({ kind: "screen" });
  w.__voltiusTermInput("rm -rf /");
  w.__voltiusTermKey("Enter");
  expect(h.write).not.toHaveBeenCalled();
});

test("locking the screen dismisses the native keyboard", async () => {
  await useAppLockStore.getState().lockScreen();
  expect(h.invoke).toHaveBeenCalledWith("terminal_hide_keyboard");
});
