import test from "node:test";
import assert from "node:assert/strict";
import { getNativeSseEventNames } from "../src/services/nativeSseStream.ts";

test("native SSE event names are scoped by stream id", () => {
  assert.deepEqual(getNativeSseEventNames("stream-1"), {
    data: "http:sse:data:stream-1",
    closed: "http:sse:closed:stream-1",
  });
});
