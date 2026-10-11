import { test, expect } from "vitest";
import { getNativeSseEventNames } from "../src/services/nativeSseStream.ts";

test("native SSE event names are scoped by stream id", () => {
  expect(getNativeSseEventNames("stream-1")).toEqual({
    open: "http:sse:open:stream-1",
    data: "http:sse:data:stream-1",
    closed: "http:sse:closed:stream-1",
  });
});
