import { describe, expect, it } from "vitest";
import { createOutputDecoder, encodeTerminalInput } from "./terminalEncoding";

const bytes = (...b: number[]) => Uint8Array.from(b);

describe("createOutputDecoder", () => {
  it("passes UTF-8 bytes through for xterm to decode", () => {
    const data = bytes(0xe4, 0xbd);
    expect(createOutputDecoder(undefined).decode(data)).toBe(data);
    expect(createOutputDecoder("utf-8").decode(data)).toBe(data);
  });

  it("holds a GBK character split across two chunks until its tail arrives", () => {
    // 中 = D6 D0 in GBK
    const decoder = createOutputDecoder("gbk");
    expect(decoder.decode(bytes(0x61, 0xd6))).toBe("a");
    expect(decoder.decode(bytes(0xd0, 0x62))).toBe("中b");
  });

  it("drops a held partial character on reset", () => {
    const decoder = createOutputDecoder("shift-jis");
    expect(decoder.decode(bytes(0x82))).toBe("");
    decoder.reset();
    expect(decoder.decode(bytes(0x41))).toBe("A");
  });

  it("falls back to UTF-8 for a label the platform does not know", () => {
    const data = bytes(0x41);
    expect(createOutputDecoder("not-an-encoding").decode(data)).toBe(data);
  });
});

describe("encodeTerminalInput", () => {
  const roundTrip = (text: string, encoding: string) =>
    new TextDecoder(encoding).decode(encodeTerminalInput(text, encoding));

  // Array.from: TextEncoder's Uint8Array is from Node's realm, not jsdom's.
  const encoded = (text: string, encoding: string | undefined) => Array.from(encodeTerminalInput(text, encoding));

  it("encodes UTF-8 when no encoding is set", () => {
    expect(encoded("é", undefined)).toEqual([0xc3, 0xa9]);
  });

  it.each([
    ["gbk", "中文输入 ls -la"],
    ["gb18030", "中文 ㄅ ¥"],
    ["big5", "繁體中文"],
    ["euc-kr", "한국어"],
    ["shift-jis", "日本語ｶﾀｶﾅ"],
    ["euc-jp", "日本語"],
    ["iso-8859-1", "café"],
    ["windows-1251", "привет"],
    ["koi8-r", "привет"],
    ["utf-16le", "中文"],
    ["utf-16be", "中文"],
  ])("round-trips %s", (encoding, text) => {
    expect(roundTrip(text, encoding)).toBe(text);
  });

  it("emits the host encoding's bytes, not UTF-8", () => {
    expect(encoded("中", "gbk")).toEqual([0xd6, 0xd0]);
    expect(encoded("é", "iso-8859-1")).toEqual([0xe9]);
    expect(encoded("¥", "gb18030")).toEqual([0x81, 0x30, 0x84, 0x36]);
  });

  it("sends ? for a character the encoding cannot hold", () => {
    expect(encoded("a中", "iso-8859-1")).toEqual([0x61, 0x3f]);
  });
});
