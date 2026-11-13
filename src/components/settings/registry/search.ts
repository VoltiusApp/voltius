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

function matchesAll(tokens: string[], haystack: string): boolean {
  const words = haystack.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return tokens.every((tok) => haystack.includes(tok) || (tok.length >= 4 && words.some((w) => withinOneEdit(tok, w))));
}

function sectionWords(section: SettingsSection): string[] {
  const en = i18n.getFixedT("en");
  const keywords = i18n.t(`settings.nav.${section}.keywords`, { returnObjects: true, defaultValue: [] });
  return [i18n.t(`settings.nav.${section}.label`), en(`settings.nav.${section}.label`), ...(Array.isArray(keywords) ? keywords : [])];
}

function texts(keys: (string | undefined)[]): string[] {
  const en = i18n.getFixedT("en");
  return keys.filter((k): k is string => !!k).flatMap((k) => [i18n.t(k), en(k)]);
}

const haystackOf = (keys: (string | undefined)[], keywords: readonly string[], section: SettingsSection) =>
  normalizeForSearch([...texts(keys), ...keywords, ...sectionWords(section)].join(" "));

const sectionIndex = (s: SettingsSection) => SETTINGS_SECTIONS.indexOf(s);

export function searchSettings(query: string, env: PlatformEnv): SearchHit[] {
  const tokens = tokensOf(query);
  if (!tokens.length) return [];
  const settings: SearchHit[] = settingDefs()
    .filter((def) => availableOn(def, env))
    .filter((def) => matchesAll(tokens, haystackOf([def.titleKey, def.labelKey, def.descKey], def.keywords ?? [], def.section)))
    .map((def) => ({ kind: "setting", def }));
  const panels: SearchHit[] = SETTINGS_PANELS
    .filter((panel) => availableOn(panel, env))
    .filter((panel) => matchesAll(tokens, haystackOf([panel.labelKey, panel.descKey], panel.keywords, panel.section)))
    .map((panel) => ({ kind: "panel", panel }));
  const section = (h: SearchHit) => sectionIndex(h.kind === "setting" ? h.def.section : h.panel.section);
  return [...settings, ...panels].sort((a, b) => section(a) - section(b));
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
