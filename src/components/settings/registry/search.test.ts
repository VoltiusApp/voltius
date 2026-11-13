// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import i18n, { ensureLocale } from "@/i18n";
import { SETTINGS_PANELS } from "./panels";
import { highlightRanges, searchSettings, type SearchHit } from "./search";

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
