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
  test("strips bidi controls so the pasted bytes match what the terminal shows", () => {
    const trojan = 'if [ "$role" != "user\u202e \u2066# admin\u2069 \u2066" ]; then';
    expect(sanitizePasteText(trojan)).toBe('if [ "$role" != "user # admin " ]; then');
    const all = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200e\u200f\u061c";
    expect(sanitizePasteText(`a${all}b`)).toBe("ab");
  });
  test("strips zero-width characters hidden inside a command", () => {
    expect(sanitizePasteText("r\u200bm -rf\u2060 /tmp/x\ufeff")).toBe("rm -rf /tmp/x");
  });
  test("keeps right-to-left text untouched", () => {
    const rtl = 'echo "שלום עולם" && echo "مرحبا بالعالم"';
    expect(sanitizePasteText(rtl)).toBe(rtl);
  });
  test("keeps joiners inside words and emoji sequences, strips stray ones", () => {
    const persian = "echo \"\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645\"";
    expect(sanitizePasteText(persian)).toBe(persian);
    const emoji = "echo 👩\u200d💻 👩🏽\u200d💻 ❤\ufe0f\u200d🔥";
    expect(sanitizePasteText(emoji)).toBe(emoji);
    expect(sanitizePasteText("ls\u200d -la \u200cfoo")).toBe("ls -la foo");
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
