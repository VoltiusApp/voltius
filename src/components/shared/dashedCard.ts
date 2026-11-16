export type CardLayout = "grid" | "list" | "row";

const SPACING: Record<CardLayout, string> = {
  grid: "gap-4 px-4 py-4 rounded-2xl",
  list: "gap-2.5 px-4 py-2.5 rounded-xl",
  row: "gap-4 px-4 h-[72px] rounded-xl",
};

export const dashedCardClass = (layout: CardLayout): string => `flex items-center border-2 border-dashed ${SPACING[layout]}`;
