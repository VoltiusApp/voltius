import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  paste: vi.fn((_text: string) => {}),
  mountAfter: 0,
  lookups: 0,
}));
vi.mock("@/hooks/useTerminal", () => ({
  getTerminalApi: vi.fn((_id: string) => (h.lookups++ >= h.mountAfter ? { paste: h.paste } : null)),
}));

import { pasteToSession, sanitizePasteText } from "./terminalPaste";

describe("sanitizePasteText", () => {
  test("keeps printable text, tabs and newlines", () => {
    expect(sanitizePasteText("ls -la\tfoo\ncd /tmp && echo \"é ✓\"")).toBe("ls -la\tfoo\ncd /tmp && echo \"é ✓\"");
  });
  test("turns CR and CRLF into newlines", () => {
    expect(sanitizePasteText("a\r\nb\rc")).toBe("a\nb\nc");
  });
  test("strips every other C0 control, DEL and C1 controls", () => {
    const c0 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).filter((c) => c !== "\t" && c !== "\n" && c !== "\r").join("");
    const c1 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(0x80 + i)).join("");
    expect(sanitizePasteText(`x${c0}\x7f${c1}y`)).toBe("xy");
  });
  test("cannot smuggle a bracketed-paste terminator or hidden line edits", () => {
    expect(sanitizePasteText("echo safe\x1b[201~\x15rm -rf ~\x0f")).toBe("echo safe[201~rm -rf ~");
    expect(sanitizePasteText("a\x9b201~b")).toBe("a201~b");
  });
});

describe("pasteToSession", () => {
  beforeEach(() => {
    h.paste.mockClear();
    h.lookups = 0;
    h.mountAfter = 0;
  });

  test("pastes sanitised text synchronously when the terminal is cached", () => {
    void pasteToSession("s1", "a\r\nb\x1b[201~");
    expect(h.paste).toHaveBeenCalledWith("a\nb[201~");
  });

  test("retries once on the next frame for a terminal still mounting", async () => {
    h.mountAfter = 1;
    expect(await pasteToSession("s1", "uptime")).toBe(true);
    expect(h.paste).toHaveBeenCalledWith("uptime");
  });

  test("drops the paste when no terminal appears", async () => {
    h.mountAfter = Infinity;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await pasteToSession("s1", "uptime")).toBe(false);
    expect(h.paste).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
