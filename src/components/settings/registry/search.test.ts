// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import i18n, { ensureLocale } from "@/i18n";
import { SETTINGS_PANELS } from "./panels";
import { highlightRanges, matchScore, searchSettings, type SearchHit } from "./search";
import { SETTINGS_SECTIONS } from "@/stores/uiStore";

const keys = (hits: SearchHit[]) => hits.map((h) => (h.kind === "setting" ? h.def.key : `panel:${h.panel.id}`));
const everywhere = { isMobile: false, isAndroid: false };

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("searchSettings", () => {
  test("an empty query finds nothing", () => {
    expect(searchSettings("   ", everywhere)).toEqual([]);
  });

  test("matches label, description and keywords", () => {
    expect(keys(searchSettings("scrollback", everywhere))).toContain("terminal.scrollbackLines");
    expect(keys(searchSettings("retained lines", everywhere))).toContain("terminal.scrollbackLines");
    expect(keys(searchSettings("caret", everywhere))).toContain("terminal.cursorStyle");
  });

  test("all tokens must match, in any order", () => {
    const hits = keys(searchSettings("size font", everywhere));
    expect(hits).toContain("appearance.terminalFontSize");
    expect(hits).not.toContain("terminal.scrollbackLines");
  });

  test("one typo is tolerated on words of four letters or more", () => {
    expect(keys(searchSettings("curser", everywhere))).toContain("terminal.cursorStyle");
    expect(keys(searchSettings("cxr", everywhere))).not.toContain("terminal.cursorStyle");
  });

  test("the section name matches", () => {
    expect(keys(searchSettings("port forwarding", everywhere))).toContain("toggles.auto-forward");
  });

  test("English still matches in another language", async () => {
    await ensureLocale("fr");
    await i18n.changeLanguage("fr");
    expect(keys(searchSettings("scrollback", everywhere))).toContain("terminal.scrollbackLines");
  });

  test("diacritics are ignored", async () => {
    await ensureLocale("fr");
    await i18n.changeLanguage("fr");
    const label = i18n.t("settings.terminal.cursorStyle.title");
    const plain = label.normalize("NFKD").replace(/\p{M}/gu, "");
    expect(keys(searchSettings(plain, everywhere))).toContain("terminal.cursorStyle");
  });

  test("panels match by name", () => {
    expect(keys(searchSettings("two-factor", everywhere))).toContain("panel:twoFactor");
  });

  test("entries not available on the platform are left out", () => {
    const mobile = { isMobile: true, isAndroid: true };
    expect(keys(searchSettings("shortcut", mobile)).some((k) => k.startsWith("shortcuts."))).toBe(false);
    expect(keys(searchSettings("drag selects", mobile))).not.toContain("toggles.drag-selects-text");
    expect(keys(searchSettings("volume down", everywhere))).not.toContain("toggles.volume-down-ctrl");
    expect(keys(searchSettings("volume down", mobile))).toContain("toggles.volume-down-ctrl");
  });

  test("results follow the sidebar's section order", () => {
    const sections = searchSettings("sync", everywhere).map((h) => (h.kind === "setting" ? h.def.section : h.panel.section));
    const order = ["appearance", "account", "sync", "plugins", "integrations", "terminal", "sftp", "portForwarding", "hosts", "devices", "shortcuts", "diagnostics", "about"];
    expect(sections.map((s) => order.indexOf(s))).toEqual([...sections.map((s) => order.indexOf(s))].sort((a, b) => a - b));
  });

  test("regex metacharacters and non-latin queries do not throw", () => {
    for (const q of ["(", ".", "+", "[a", "свет", "主题", "*"]) {
      expect(() => searchSettings(q, everywhere)).not.toThrow();
    }
  });
});

describe("panels", () => {
  test("every panel has a translated label and a real section", () => {
    for (const p of SETTINGS_PANELS) {
      expect(i18n.exists(p.labelKey, { lng: "en" }), p.id).toBe(true);
      if (p.descKey) expect(i18n.exists(p.descKey, { lng: "en" }), p.id).toBe(true);
    }
    expect(new Set(SETTINGS_PANELS.map((p) => p.id)).size).toBe(SETTINGS_PANELS.length);
  });
});

describe("highlightRanges", () => {
  test("marks each token, case and accent insensitive", () => {
    expect(highlightRanges("Terminal scrollback", "SCROLL term")).toEqual([[0, 4], [9, 15]]);
    expect(highlightRanges("Thème", "theme")).toEqual([[0, 5]]);
  });

  test("merges overlapping ranges and ignores missing tokens", () => {
    expect(highlightRanges("cursor", "cur urs zzz")).toEqual([[0, 4]]);
  });
});

describe("section keywords", () => {
  test("a section's keywords do not make every setting in it match", () => {
    const hits = keys(searchSettings("scrollback", everywhere));
    expect(hits).toContain("terminal.scrollbackLines");
    expect(hits).not.toContain("terminal.cursorStyle");
  });
});

describe("ranking", () => {
  const order = (q: string) => keys(searchSettings(q, everywhere));

  test("a title match ranks above a description-only match in the same section", () => {
    const hits = order("scrollback");
    expect(hits.indexOf("terminal.scrollbackLines")).toBeLessThan(hits.indexOf("toggles.scroll-minimap"));
  });

  test("a title that starts with the word ranks above one that only contains it", () => {
    const hits = order("cursor");
    expect(hits.indexOf("toggles.cursor-blink")).toBeLessThan(hits.indexOf("toggles.select-to-copy") === -1 ? Infinity : hits.indexOf("toggles.select-to-copy"));
    expect(hits[0]?.startsWith("toggles.cursor") || hits[0] === "terminal.cursorStyle").toBe(true);
  });

  test("score tiers: title start < title word < keyword < description < one typo", () => {
    const fields = (title: string, keywords: string[] = [], desc = "") => ({ titles: [title], keywords, descs: [desc], sections: ["Terminal"] });
    const score = (q: string, f: ReturnType<typeof fields>) => matchScore(q, f);
    const start = score("cursor", fields("Cursor style"));
    const word = score("cursor", fields("Terminal cursor"));
    const keyword = score("cursor", fields("Caret", ["cursor"]));
    const desc = score("cursor", fields("Caret", [], "Shape of the cursor"));
    const typo = score("cursor", fields("Curser"));
    expect([start, word, keyword, desc, typo].every((n) => n !== null)).toBe(true);
    expect(start!).toBeLessThan(word!);
    expect(word!).toBeLessThan(keyword!);
    expect(keyword!).toBeLessThan(desc!);
    expect(desc!).toBeLessThan(typo!);
    expect(score("zzz", fields("Cursor style"))).toBeNull();
  });

  test("sections keep the sidebar order", () => {
    const sections = searchSettings("sync", everywhere).map((h) => (h.kind === "setting" ? h.def.section : h.panel.section));
    const idx = sections.map((s) => SETTINGS_SECTIONS.indexOf(s));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  test("the same query returns the same results without searching again", () => {
    expect(searchSettings("proxy", everywhere)).toBe(searchSettings("proxy", everywhere));
  });
});
