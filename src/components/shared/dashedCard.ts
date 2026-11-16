export const dashedCardClass = (layout: "grid" | "list"): string =>
  `flex items-center border-2 border-dashed ${layout === "list" ? "gap-2.5 px-4 py-2.5 rounded-xl" : "gap-4 px-4 py-4 rounded-2xl"}`;
