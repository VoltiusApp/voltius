import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYWORD_RULES,
  MAX_KEYWORD_LENGTH,
  MAX_KEYWORD_RULES,
  MAX_KEYWORD_WORDS,
  compileKeywordRules,
  sameKeywordRules,
  sanitizeKeywordRules,
  type KeywordRule,
} from "./keywordMatcher";

const rule = (color: KeywordRule["color"], words: string[], enabled = true): KeywordRule => ({
  id: `${color}-${words[0]}`,
  color,
  words,
  enabled,
});

const match = (text: string, rules: KeywordRule[] = DEFAULT_KEYWORD_RULES) =>
  compileKeywordRules(rules)!(text).map((m) => [text.slice(m.start, m.end), m.color]);

describe("compileKeywordRules", () => {
  it("matches whole words in any case", () => {
    expect(match("ERROR: build Failed, 2 warnings")).toEqual([
      ["ERROR", "red"],
      ["Failed", "red"],
      ["warnings", "yellow"],
    ]);
  });

  it("ignores a keyword inside a longer word", () => {
    expect(match("my_error errored terror okay 2errors")).toEqual([]);
  });

  it("treats punctuation as a boundary", () => {
    expect(match("error.log [ok] failed!")).toEqual([
      ["error", "red"],
      ["ok", "green"],
      ["failed", "red"],
    ]);
  });

  it("prefers the longest word, across rules too", () => {
    const rules = [rule("red", ["denied"]), rule("magenta", ["permission denied"])];
    expect(match("permission denied", rules)).toEqual([["permission denied", "magenta"]]);
  });

  it("gives a word listed twice the colour of the first rule", () => {
    expect(match("ok", [rule("blue", ["ok"]), rule("green", ["ok"])])).toEqual([["ok", "blue"]]);
  });

  it("skips disabled rules", () => {
    expect(match("error ok", [rule("red", ["error"], false), rule("green", ["ok"])])).toEqual([["ok", "green"]]);
  });

  it("returns null when no enabled rule has a word", () => {
    expect(compileKeywordRules([])).toBeNull();
    expect(compileKeywordRules([rule("red", ["error"], false), rule("green", [])])).toBeNull();
  });

  it("matches words holding regex characters literally", () => {
    const rules = [rule("red", ["c++", "[fail]", "a.b"])];
    expect(match("c++ [fail]x axb a.b", rules)).toEqual([
      ["c++", "red"],
      ["[fail]", "red"],
      ["a.b", "red"],
    ]);
  });

  it("applies boundaries to non-ASCII words written with spaces", () => {
    expect(match("ошибка: подошибка ошибка", [rule("red", ["ошибка"])])).toEqual([
      ["ошибка", "red"],
      ["ошибка", "red"],
    ]);
  });

  it("needs no boundary for scripts written without spaces", () => {
    expect(match("发生错误了", [rule("red", ["错误"])])).toEqual([["错误", "red"]]);
  });

  it("terminates when a rejected match starts with an astral character", () => {
    expect(match("a𝒆rr 𝒆rr", [rule("red", ["𝒆rr"])])).toEqual([["𝒆rr", "red"]]);
  });

  it("finds a match that overlaps a rejected one", () => {
    const rules = [rule("red", ["a b"]), rule("green", ["b c"])];
    expect(match("xa b c", rules)).toEqual([["b c", "green"]]);
  });
});

describe("sameKeywordRules", () => {
  it("holds for the defaults after sanitising, whatever the key order", () => {
    expect(sameKeywordRules(sanitizeKeywordRules(JSON.parse(JSON.stringify(DEFAULT_KEYWORD_RULES))), DEFAULT_KEYWORD_RULES)).toBe(true);
  });

  it("sees a change in any field, the word order and the rule count", () => {
    const base = [rule("red", ["a", "b"])];
    expect(sameKeywordRules(base, [{ ...base[0], id: "other" }])).toBe(false);
    expect(sameKeywordRules(base, [{ ...base[0], color: "blue" }])).toBe(false);
    expect(sameKeywordRules(base, [{ ...base[0], enabled: false }])).toBe(false);
    expect(sameKeywordRules(base, [{ ...base[0], words: ["b", "a"] }])).toBe(false);
    expect(sameKeywordRules(base, [{ ...base[0], words: ["a"] }])).toBe(false);
    expect(sameKeywordRules(base, [...base, rule("green", ["c"])])).toBe(false);
  });
});

describe("sanitizeKeywordRules", () => {
  it("falls back to the defaults for anything that is not a list", () => {
    expect(sanitizeKeywordRules(undefined)).toEqual(DEFAULT_KEYWORD_RULES);
    expect(sanitizeKeywordRules("error")).toEqual(DEFAULT_KEYWORD_RULES);
  });

  it("keeps an empty list empty", () => {
    expect(sanitizeKeywordRules([])).toEqual([]);
  });

  it("drops rules with a bad shape, an unknown colour or a repeated id", () => {
    const good = { id: "a", color: "red", words: ["x"], enabled: true };
    expect(
      sanitizeKeywordRules([
        null,
        "rule",
        { id: "", color: "red", words: [] },
        { id: "b", color: "pink", words: [] },
        good,
        { ...good, words: ["y"] },
      ]),
    ).toEqual([good]);
  });

  it("trims, lowercases and dedupes words and drops empty or non-string ones", () => {
    const [clean] = sanitizeKeywordRules([{ id: "a", color: "red", words: [" Error ", "error", "", 3, "OK"] }]);
    expect(clean.words).toEqual(["error", "ok"]);
  });

  it("treats a missing enabled flag as on and a missing word list as empty", () => {
    expect(sanitizeKeywordRules([{ id: "a", color: "red" }])).toEqual([
      { id: "a", color: "red", words: [], enabled: true },
    ]);
  });

  it("applies the limits", () => {
    const words = Array.from({ length: MAX_KEYWORD_WORDS + 5 }, (_, i) => `w${i}`);
    const rules = Array.from({ length: MAX_KEYWORD_RULES + 5 }, (_, i) => ({ id: `r${i}`, color: "red", words }));
    const clean = sanitizeKeywordRules(rules);
    expect(clean).toHaveLength(MAX_KEYWORD_RULES);
    expect(clean[0].words).toHaveLength(MAX_KEYWORD_WORDS);
    const [long] = sanitizeKeywordRules([{ id: "a", color: "red", words: ["x".repeat(MAX_KEYWORD_LENGTH + 10)] }]);
    expect(long.words[0]).toHaveLength(MAX_KEYWORD_LENGTH);
  });
});
