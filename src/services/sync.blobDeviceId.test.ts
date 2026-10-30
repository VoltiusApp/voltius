// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { blobDeviceId } from "@/services/sync";

function blobWith(header: string | object, tail = [1, 2, 3]): number[] {
  const json = new TextEncoder().encode(typeof header === "string" ? header : JSON.stringify(header));
  const len = new Uint8Array(new Uint32Array([json.length]).buffer);
  return [...len, ...json, ...tail];
}

describe("blobDeviceId", () => {
  test("blob_device_id_reads_the_header", () => {
    expect(blobDeviceId(blobWith({ version: 1, account_id: "a", device_id: "dev-b", created_at: "t" }))).toBe("dev-b");
    expect(blobDeviceId([1, 0, 0])).toBeNull();
    expect(blobDeviceId([255, 0, 0, 0, 123, 125])).toBeNull();
    expect(blobDeviceId(blobWith("not json"))).toBeNull();
    expect(blobDeviceId(blobWith({ version: 1, device_id: 5 }))).toBeNull();
    expect(blobDeviceId(blobWith({ version: 1 }))).toBeNull();
  });
});
