import { test, expect } from "vitest";

const sources = import.meta.glob(["/src/**/*.{ts,tsx,css}", "!/src/**/*.test.{ts,tsx}"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

test("every --t-status-* token the UI reads is one the theme sets", () => {
  const defined = new Set([...sources["/src/hooks/useApplyTheme.ts"].matchAll(/setProperty\("(--t-status-[a-z-]+)"/g)].map((m) => m[1]));
  expect(defined.size).toBeGreaterThan(0);
  const undefinedUses = Object.entries(sources).flatMap(([file, text]) =>
    [...text.matchAll(/--t-status-[a-z]+(?:-[a-z]+)*/g)]
      .map((m) => m[0])
      .filter((token) => !defined.has(token))
      .map((token) => `${file}: ${token}`),
  );
  expect(undefinedUses).toEqual([]);
});
