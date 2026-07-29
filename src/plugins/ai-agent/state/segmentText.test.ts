import { describe, it, expect } from "vitest";
import { segmentText } from "./segmentText";

const ids = (...xs: string[]) => new Set(xs);

describe("segmentText", () => {
  it("returns plain text when there are no known ids", () => {
    expect(segmentText("hello conn_1", ids())).toEqual([{ type: "text", value: "hello conn_1" }]);
  });

  it("returns [] for empty text", () => {
    expect(segmentText("", ids("conn_1"))).toEqual([]);
  });

  it("splits an id in the middle", () => {
    expect(segmentText("open conn_1 now", ids("conn_1"))).toEqual([
      { type: "text", value: "open " },
      { type: "ref", id: "conn_1" },
      { type: "text", value: " now" },
    ]);
  });

  it("matches an id at the very start and very end", () => {
    expect(segmentText("conn_1", ids("conn_1"))).toEqual([{ type: "ref", id: "conn_1" }]);
    expect(segmentText("x conn_1", ids("conn_1"))).toEqual([
      { type: "text", value: "x " },
      { type: "ref", id: "conn_1" },
    ]);
  });

  it("handles two adjacent ids", () => {
    expect(segmentText("conn_1conn_2", ids("conn_1", "conn_2"))).toEqual([
      { type: "ref", id: "conn_1" },
      { type: "ref", id: "conn_2" },
    ]);
  });

  it("prefers the longer id when one is a substring of another", () => {
    expect(segmentText("conn_1x", ids("conn_1", "conn_1x"))).toEqual([{ type: "ref", id: "conn_1x" }]);
  });

  it("leaves an unknown id as text", () => {
    expect(segmentText("conn_9", ids("conn_1"))).toEqual([{ type: "text", value: "conn_9" }]);
  });

  it("does not match a partial id (mid-stream tail)", () => {
    // The full id is conn_1234; only 'conn_12' has streamed so far.
    expect(segmentText("id conn_12", ids("conn_1234"))).toEqual([{ type: "text", value: "id conn_12" }]);
  });

  it("matches ids containing regex-special characters literally", () => {
    expect(segmentText("x a.b+c y", ids("a.b+c"))).toEqual([
      { type: "text", value: "x " },
      { type: "ref", id: "a.b+c" },
      { type: "text", value: " y" },
    ]);
  });
});
