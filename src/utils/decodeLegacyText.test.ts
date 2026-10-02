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
});
