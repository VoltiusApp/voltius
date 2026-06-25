import type { Chunk } from "@codemirror/merge";

export type ChunkKind = "ins" | "del" | "mod";

export function chunkKind(c: Chunk): ChunkKind {
  const emptyA = c.fromA === c.toA;
  const emptyB = c.fromB === c.toB;
  if (emptyA && !emptyB) return "ins";
  if (emptyB && !emptyA) return "del";
  return "mod";
}

const EPS = 1;

// `tops` are the chunks' content-space y positions, ascending. Index of the last
// chunk at or above the viewport midpoint; 0 if all are below; -1 if there are none.
export function activeChunkIndex(tops: number[], viewportMid: number): number {
  if (tops.length === 0) return -1;
  let idx = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= viewportMid) idx = i;
    else break;
  }
  return idx;
}

export function nextChunkIndex(tops: number[], scrollTop: number): number | null {
  for (let i = 0; i < tops.length; i++) if (tops[i] > scrollTop + EPS) return i;
  return null;
}

export function prevChunkIndex(tops: number[], scrollTop: number): number | null {
  for (let i = tops.length - 1; i >= 0; i--) if (tops[i] < scrollTop - EPS) return i;
  return null;
}
