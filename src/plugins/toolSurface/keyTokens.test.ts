import { describe, it, expect } from "vitest";
import { tokensToBytes } from "./keyTokens";

const ok = (r: ReturnType<typeof tokensToBytes>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.text;
};

describe("tokensToBytes", () => {
  it("types literal text verbatim", () => {
    expect(ok(tokensToBytes(["hello world"], false))).toBe("hello world");
  });

  it("maps Enter to CR, never LF", () => {
    expect(ok(tokensToBytes(["Enter"], false))).toBe("\r");
  });

  it("maps the named keys that terminalKeyCore already knows", () => {
    expect(ok(tokensToBytes(["Escape", "Tab", "Up", "PageDown"], false))).toBe("\x1b\t\x1b[A\x1b[6~");
  });

  it("sends arrows in application-cursor form when the mode is set", () => {
    expect(ok(tokensToBytes(["Up", "Left"], true))).toBe("\x1bOA\x1bOD");
  });

  it("maps the keys terminalKeyCore lacks", () => {
    expect(ok(tokensToBytes(["Space", "Backspace", "Delete", "Insert"], false))).toBe(" \x7f\x1b[3~\x1b[2~");
  });

  it("maps function keys", () => {
    expect(ok(tokensToBytes(["F1", "F5", "F12"], false))).toBe("\x1bOP\x1b[15~\x1b[24~");
  });

  it("maps control and meta chords", () => {
    expect(ok(tokensToBytes(["C-c", "C-d", "M-x"], false))).toBe("\x03\x04\x1bx");
  });

  it("concatenates a whole interaction in order", () => {
    expect(ok(tokensToBytes(["top", "Enter", "Down", "C-c"], false))).toBe("top\r\x1b[B\x03");
  });

  it("types a key name literally when it is prefixed lit:", () => {
    expect(ok(tokensToBytes(["lit:Enter"], false))).toBe("Enter");
  });

  it("strips exactly one lit: prefix", () => {
    expect(ok(tokensToBytes(["lit:lit:x"], false))).toBe("lit:x");
  });

  it("refuses a token that looks like a key name but is not one", () => {
    const r = tokensToBytes(["Esc"], false);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("Escape");
  });

  it("refuses a mistyped chord", () => {
    expect(tokensToBytes(["Ctrl-c"], false)).toMatchObject({ ok: false });
  });

  it("refuses an empty token list", () => {
    expect(tokensToBytes([], false)).toMatchObject({ ok: false });
  });

  it("refuses more than 64 tokens", () => {
    expect(tokensToBytes(Array(65).fill("a"), false)).toMatchObject({ ok: false });
  });

  it("refuses more than 4096 characters of literal text", () => {
    expect(tokensToBytes(["x".repeat(4097)], false)).toMatchObject({ ok: false });
  });

  it("does not refuse ordinary lowercase words that are not keys", () => {
    expect(ok(tokensToBytes(["ls -la"], false))).toBe("ls -la");
  });
});
