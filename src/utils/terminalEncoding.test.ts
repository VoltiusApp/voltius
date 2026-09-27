import { describe, expect, it } from "vitest";
import { createOutputDecoder, createTextDecoder, createUtf8Transcoder, encodeTerminalInput } from "./terminalEncoding";

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

describe("createUtf8Transcoder", () => {
  it("re-encodes a legacy stream as UTF-8, holding a split character", () => {
    const toUtf8 = createUtf8Transcoder("gbk");
    expect(Array.from(toUtf8(bytes(0x61, 0xd6)))).toEqual([0x61]);
    expect(new TextDecoder().decode(toUtf8(bytes(0xd0)))).toBe("中");
  });

  it("passes UTF-8 through", () => {
    const data = bytes(0xe4, 0xb8, 0xad);
    expect(createUtf8Transcoder(undefined)(data)).toBe(data);
  });
});

describe("createTextDecoder", () => {
  it("decodes with the session's encoding, UTF-8 when unset or unknown", () => {
    expect(createTextDecoder("gbk").decode(bytes(0xd6, 0xd0))).toBe("中");
    expect(createTextDecoder(undefined).encoding).toBe("utf-8");
    expect(createTextDecoder("not-an-encoding").encoding).toBe("utf-8");
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

  it("follows the WHATWG encoders where a character has more than one sequence", () => {
    expect(encoded("€", "gb18030")).toEqual([0xa2, 0xe3]);
    expect(encoded("€", "gbk")).toEqual([0x80]);
    expect(encoded("═", "big5")).toEqual([0xf9, 0xf9]);
    expect(encoded("纊", "shift-jis")).toEqual([0xfa, 0x5c]);
    expect(encoded("¥‾", "shift-jis")).toEqual([0x5c, 0x7e]);
  });

  it("encodes gb18030's four-byte forms", () => {
    expect(encoded("😀", "gb18030")).toEqual([0x94, 0x39, 0xfc, 0x36]);
    expect(roundTrip("😀𠀀ḿ", "gb18030")).toBe("😀𠀀ḿ");
  });

  it("maps the JIS twins an IME types to the bytes the host decodes", () => {
    expect(encoded("〜−‖", "shift-jis")).toEqual([0x81, 0x60, 0x81, 0x7c, 0x81, 0x61]);
    expect(encoded("¢", "euc-jp")).toEqual([0xa1, 0xf1]);
  });

  it("splits a Vietnamese letter into the precomposed base and mark windows-1258 holds", () => {
    expect(encoded("ệ", "windows-1258")).toEqual([0xea, 0xf2]);
    expect(roundTrip("Tiếng Việt", "windows-1258").normalize("NFC")).toBe("Tiếng Việt");
  });

  it("keeps NUL", () => {
    expect(encoded("\0a", "big5")).toEqual([0x00, 0x61]);
  });

  it("sends ? for a character the encoding cannot hold", () => {
    expect(encoded("a中", "iso-8859-1")).toEqual([0x61, 0x3f]);
  });
});
