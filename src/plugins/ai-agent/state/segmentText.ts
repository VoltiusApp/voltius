export type Segment = { type: "text"; value: string } | { type: "ref"; id: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split `text` on exact matches of any id in `knownIds`. Ids are matched
 * longest-first (so a longer id wins when another id is its prefix) and every
 * id is regex-escaped. Streaming-safe: a partially-streamed id simply does not
 * match until complete.
 */
export function segmentText(text: string, knownIds: Set<string>): Segment[] {
  if (text === "") return [];
  if (knownIds.size === 0) return [{ type: "text", value: text }];

  const alternation = [...knownIds].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  const re = new RegExp(alternation, "g");

  const out: Segment[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({ type: "ref", id: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}
