import { test, expect } from "vitest";

const sources = import.meta.glob("/src/**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

test("no component but TriStateToggle renders an allow/inherit/deny radiogroup", () => {
  const offenders = Object.entries(sources)
    .filter(([path]) => !path.endsWith("/TriStateToggle.tsx") && !path.includes(".test."))
    .filter(([, src]) => src.includes('role="radiogroup"') && /"inherit"/.test(src) && /"deny"/.test(src))
    .map(([path]) => path);
  expect(offenders).toEqual([]);
});
