import { describe, it, expect } from "vitest";
import { Chunk } from "@codemirror/merge";
import { chunkKind, activeChunkIndex, nextChunkIndex, prevChunkIndex } from "./diffChunks";

const mk = (fromA: number, toA: number, fromB: number, toB: number) =>
  new Chunk([], fromA, toA, fromB, toB);

describe("chunkKind", () => {
  it("empty in A → ins", () => { expect(chunkKind(mk(5, 5, 5, 12))).toBe("ins"); });
  it("empty in B → del", () => { expect(chunkKind(mk(5, 12, 5, 5))).toBe("del"); });
  it("present both sides → mod", () => { expect(chunkKind(mk(5, 12, 5, 14))).toBe("mod"); });
});

describe("activeChunkIndex", () => {
  const tops = [0, 100, 200, 300];
  it("returns -1 when empty", () => { expect(activeChunkIndex([], 50)).toBe(-1); });
  it("returns 0 when all chunks are below the viewport mid", () => {
    expect(activeChunkIndex(tops, -10)).toBe(0);
  });
  it("returns the last chunk at or above the viewport mid", () => {
    expect(activeChunkIndex(tops, 250)).toBe(2);
  });
  it("returns the final index when mid is past the last chunk", () => {
    expect(activeChunkIndex(tops, 9999)).toBe(3);
  });
});

describe("nextChunkIndex / prevChunkIndex", () => {
  const tops = [0, 100, 200, 300];
  it("next returns the first chunk strictly below scrollTop", () => {
    expect(nextChunkIndex(tops, 100)).toBe(2);
  });
  it("next returns null past the last chunk", () => {
    expect(nextChunkIndex(tops, 300)).toBeNull();
  });
  it("prev returns the last chunk strictly above scrollTop", () => {
    expect(prevChunkIndex(tops, 200)).toBe(1);
  });
  it("prev returns null before the first chunk", () => {
    expect(prevChunkIndex(tops, 0)).toBeNull();
  });
});
