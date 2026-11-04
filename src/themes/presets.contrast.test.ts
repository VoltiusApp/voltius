import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES } from "./presets";
import { contrastRatio } from "@/utils/appearance";

const SURFACES = ["bgTerminal", "bgBase", "bgCard", "bgModal", "bgInput"] as const;
const SECONDARY_TEXT = ["textDim", "textMuted", "textSecondary", "textNotice"] as const;
const AA_BODY = 4.5;

const worst = (fg: string, ui: Record<string, string>) =>
  Math.min(...SURFACES.map((s) => contrastRatio(fg, ui[s]) ?? 0));

describe.each(BUILT_IN_THEMES.map((t) => [t.id, t.ui as unknown as Record<string, string>]))("%s", (_id, ui) => {
  it.each(SECONDARY_TEXT)("%s is readable on every text surface", (token) => {
    expect(worst(ui[token], ui)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("primary text stays above every secondary tier", () => {
    const primary = worst(ui.textPrimary, ui);
    for (const token of SECONDARY_TEXT) expect(primary).toBeGreaterThan(worst(ui[token], ui));
  });

  it("distinct secondary tiers stay visibly apart", () => {
    const tiers = [...new Set(SECONDARY_TEXT.map((t) => ui[t]))].map((c) => worst(c, ui)).sort((a, b) => a - b);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i] - tiers[i - 1]).toBeGreaterThanOrEqual(0.4);
  });
});
