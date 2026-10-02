import { describe, expect, it } from "vitest";
import { decodeLegacyText } from "./decodeLegacyText";

describe("decodeLegacyText", () => {
  it("keeps UTF-8 lines and reads the others as Windows-1252", () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('name=utf8:"Café"\r\n'),
      ...[0x42, 0xe4, 0x63, 0x6b, 0x65, 0x6e, 0x64, 0x0d, 0x0a],
    ]);
    expect(decodeLegacyText(bytes)).toBe('name=utf8:"Café"\r\nBäckend\r\n');
  });

  it("strips a UTF-8 byte order mark", () => {
    expect(decodeLegacyText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
  });

  it("reads UTF-16 files that start with a byte order mark, as regedit exports them", () => {
    const text = 'Windows Registry Editor Version 5.00\r\n"HostName"="café"\r\n';
    const le = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    const be = new Uint8Array([0xfe, 0xff, ...Array.from(text).flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff])]);
    expect(decodeLegacyText(le)).toBe(text);
    expect(decodeLegacyText(be)).toBe(text);
  });
});
