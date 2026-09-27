import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("base64", () => {
  it("matches btoa on a small input", () => {
    expect(bytesToBase64(new Uint8Array([104, 105, 0, 255]))).toBe(btoa("hi\x00\xff"));
    expect(bytesToBase64([104, 105])).toBe("aGk=");
  });

  it("round-trips an empty input", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
    expect(base64ToBytes("")).toEqual(new Uint8Array());
  });

  it("encodes and decodes more than 1 MB without overflowing the stack", () => {
    const bytes = new Uint8Array(1536 * 1024 + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    // The unchunked spread this replaces throws a RangeError at this size.
    expect(() => btoa(String.fromCharCode(...bytes))).toThrow(RangeError);
    const b64 = bytesToBase64(bytes);
    expect(b64.length).toBe(Math.ceil(bytes.length / 3) * 4);
    expect(b64.startsWith(btoa(String.fromCharCode(...bytes.subarray(0, 3000))))).toBe(true);
    const decoded = base64ToBytes(b64);
    expect(decoded.length).toBe(bytes.length);
    expect(decoded.every((b, i) => b === bytes[i])).toBe(true);
  });
});
