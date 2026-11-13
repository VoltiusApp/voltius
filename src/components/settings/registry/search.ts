import i18n from "@/i18n";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/stores/uiStore";
import { normalizeForSearch } from "@/utils/search";
import { availableOn, type PlatformEnv } from "./defaults";
import { settingDefs } from "./entries";
import { SETTINGS_PANELS, type SettingsPanel } from "./panels";
import type { SettingDef } from "./types";

export type SearchHit = { kind: "setting"; def: SettingDef } | { kind: "panel"; panel: SettingsPanel };

const tokensOf = (query: string) => normalizeForSearch(query).split(/\s+/).filter(Boolean);

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export interface SearchFields {
  titles: readonly string[];
  keywords: readonly string[];
  descs: readonly string[];
  sections: readonly string[];
}

const wordsOf = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Lower is a better match: 0 title starts with the word … 6 one typo away. */
function tokenTier(tok: string, f: SearchFields): number | null {
  const titles = f.titles.map(normalizeForSearch);
  if (titles.some((t) => t.startsWith(tok))) return 0;
  if (titles.some((t) => wordsOf(t).some((w) => w.startsWith(tok)))) return 1;
  if (titles.some((t) => t.includes(tok))) return 2;
  if (f.keywords.some((k) => normalizeForSearch(k).includes(tok))) return 3;
  if (f.descs.some((d) => normalizeForSearch(d).includes(tok))) return 4;
  if (f.sections.some((sec) => normalizeForSearch(sec).includes(tok))) return 5;
  if (tok.length < 4) return null;
  const all = [...titles, ...f.keywords, ...f.descs].map(normalizeForSearch).flatMap(wordsOf);
  return all.some((w) => w.length >= 3 && withinOneEdit(tok, w)) ? 6 : null;
}

/** Sum of each word's best tier, or null when a word matches nothing. */
export function matchScore(query: string, f: SearchFields): number | null {
  const tokens = tokensOf(query);
  if (!tokens.length) return null;
  let total = 0;
  for (const tok of tokens) {
    const tier = tokenTier(tok, f);
    if (tier === null) return null;
    total += tier;
  }
  return total;
}

function sectionWords(section: SettingsSection): string[] {
  const en = i18n.getFixedT("en");
  return [i18n.t(`settings.nav.${section}.label`), en(`settings.nav.${section}.label`)];
}

function texts(keys: (string | undefined)[]): string[] {
  const en = i18n.getFixedT("en");
  return keys.filter((k): k is string => !!k).flatMap((k) => [i18n.t(k), en(k)]);
}

const fieldsOf = (titleKeys: (string | undefined)[], descKey: string | undefined, keywords: readonly string[], section: SettingsSection): SearchFields => ({
  titles: texts(titleKeys),
  keywords,
  descs: texts([descKey]),
  sections: sectionWords(section),
});

const sectionIndex = (s: SettingsSection) => SETTINGS_SECTIONS.indexOf(s);

let last: { key: string; hits: SearchHit[] } | undefined;

export function searchSettings(query: string, env: PlatformEnv): SearchHit[] {
  if (!tokensOf(query).length) return [];
  const key = JSON.stringify([query, env.isMobile, env.isAndroid, i18n.language]);
  if (last?.key === key) return last.hits;
  const scored: { hit: SearchHit; section: SettingsSection; score: number; order: number }[] = [];
  settingDefs().forEach((def, order) => {
    if (!availableOn(def, env)) return;
    const score = matchScore(query, fieldsOf([def.titleKey, def.labelKey], def.descKey, def.keywords ?? [], def.section));
    if (score !== null) scored.push({ hit: { kind: "setting", def }, section: def.section, score, order });
  });
  SETTINGS_PANELS.forEach((panel, i) => {
    if (!availableOn(panel, env)) return;
    const score = matchScore(query, fieldsOf([panel.labelKey], panel.descKey, panel.keywords, panel.section));
    if (score !== null) scored.push({ hit: { kind: "panel", panel }, section: panel.section, score, order: 10_000 + i });
  });
  scored.sort((a, b) => sectionIndex(a.section) - sectionIndex(b.section) || a.score - b.score || a.order - b.order);
  const hits = scored.map((s) => s.hit);
  last = { key, hits };
  return hits;
}

/** Character ranges of `text` that match a query token, merged and sorted. */
export function highlightRanges(text: string, query: string): [number, number][] {
  const tokens = tokensOf(query);
  if (!tokens.length) return [];
  let folded = "";
  const origin: number[] = [];
  let offset = 0;
  for (const ch of text) {
    const f = normalizeForSearch(ch);
    for (let k = 0; k < f.length; k++) origin.push(offset);
    folded += f;
    offset += ch.length;
  }
  origin.push(text.length);
  const ranges: [number, number][] = [];
  for (const tok of tokens) {
    for (let at = folded.indexOf(tok); at !== -1; at = folded.indexOf(tok, at + 1)) {
      const end = at + tok.length;
      ranges.push([origin[at], end < origin.length - 1 ? origin[end] : text.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
