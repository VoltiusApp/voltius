import test from "node:test";
import assert from "node:assert/strict";
import { SseDataLineParser } from "../src/services/realtimeSseEvents.ts";

test("SSE data parser preserves data lines split across chunks", () => {
  const parser = new SseDataLineParser();

  assert.deepEqual(parser.push("data: tea"), []);
  assert.deepEqual(parser.push("m:team-a\n"), ["team:team-a"]);
});

test("SSE data parser flushes final unterminated data line", () => {
  const parser = new SseDataLineParser();

  assert.deepEqual(parser.push("data: presence:user-a:online"), []);
  assert.deepEqual(parser.flush(), ["presence:user-a:online"]);
});
