import { test, expect } from "vitest";
import { parseUsingEvent } from "./presenceEvent.ts";

test("parses a well-formed in-use event", () => {
  expect(parseUsingEvent("using:user-1:conn-9:1")).toEqual({ userId: "user-1", connectionId: "conn-9", inUse: true });
});

test("parses a not-in-use event (trailing 0)", () => {
  expect(parseUsingEvent("using:user-1:conn-9:0")).toEqual({ userId: "user-1", connectionId: "conn-9", inUse: false });
});

test("connection id containing colons is preserved (uses last colon as inUse delimiter)", () => {
  expect(parseUsingEvent("using:u1:a:b:c:1")).toEqual({ userId: "u1", connectionId: "a:b:c", inUse: true });
});

test("any trailing value other than '1' is not-in-use", () => {
  expect(parseUsingEvent("using:u1:c1:x")?.inUse).toBe(false);
});

test("returns null for non-'using:' lines", () => {
  expect(parseUsingEvent("presence:u1:online")).toBeNull();
});

test("returns null when there are too few segments", () => {
  expect(parseUsingEvent("using:onlyone")).toBeNull();   // no second colon
  expect(parseUsingEvent("using:u1:")).toBeNull();        // empty connection id region / no distinct delimiters
  expect(parseUsingEvent("using:")).toBeNull();
});
