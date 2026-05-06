export interface TagColorStyle {
  backgroundColor: string;
  borderColor: string;
  color: string;
}

const TAG_COLOR_PALETTE: TagColorStyle[] = [
  { backgroundColor: "rgba(56, 189, 248, 0.14)", borderColor: "rgba(56, 189, 248, 0.34)", color: "#7dd3fc" },
  { backgroundColor: "rgba(129, 140, 248, 0.14)", borderColor: "rgba(129, 140, 248, 0.34)", color: "#a5b4fc" },
  { backgroundColor: "rgba(168, 85, 247, 0.14)", borderColor: "rgba(168, 85, 247, 0.34)", color: "#c084fc" },
  { backgroundColor: "rgba(236, 72, 153, 0.14)", borderColor: "rgba(236, 72, 153, 0.34)", color: "#f9a8d4" },
  { backgroundColor: "rgba(244, 63, 94, 0.14)", borderColor: "rgba(244, 63, 94, 0.34)", color: "#fda4af" },
  { backgroundColor: "rgba(249, 115, 22, 0.14)", borderColor: "rgba(249, 115, 22, 0.34)", color: "#fdba74" },
  { backgroundColor: "rgba(234, 179, 8, 0.14)", borderColor: "rgba(234, 179, 8, 0.34)", color: "#fde047" },
  { backgroundColor: "rgba(34, 197, 94, 0.14)", borderColor: "rgba(34, 197, 94, 0.34)", color: "#86efac" },
  { backgroundColor: "rgba(20, 184, 166, 0.14)", borderColor: "rgba(20, 184, 166, 0.34)", color: "#5eead4" },
  { backgroundColor: "rgba(45, 212, 191, 0.14)", borderColor: "rgba(45, 212, 191, 0.34)", color: "#99f6e4" },
];

function tagHash(tag: string) {
  let hash = 0;
  for (const char of tag.trim().toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getTagColorStyle(tag: string): TagColorStyle {
  return TAG_COLOR_PALETTE[tagHash(tag) % TAG_COLOR_PALETTE.length];
}
