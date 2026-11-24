// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ write: vi.fn(), invoke: vi.fn(async () => undefined) }));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/hooks/useTerminal", () => ({ writeToSession: h.write }));
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: vi.fn() }));
vi.mock("@/services/account", () => ({ getAppLock: async () => null, setAppLock: async () => {} }));

import { showAndroidKeyboard } from "./androidKeyboard";

const w = window as unknown as { __voltiusTermInput: (t: string) => void; __voltiusTermKey: (k: string) => void };

beforeEach(() => {
  vi.clearAllMocks();
  showAndroidKeyboard("s1");
});

test("Enter sent as a key event is a carriage return", () => {
  w.__voltiusTermKey("Enter");
  expect(h.write).toHaveBeenCalledWith("s1", "\r");
});

test("Enter committed as a newline character is a carriage return too", () => {
  w.__voltiusTermInput("\n");
  expect(h.write).toHaveBeenCalledWith("s1", "\r");
});

test("newlines inside committed text become carriage returns", () => {
  w.__voltiusTermInput("ls\r\npwd\n");
  expect(h.write).toHaveBeenCalledWith("s1", "ls\rpwd\r");
});
