import { test, expect } from "vitest";

// openPortal() opens the subscription-management page, which is useless to
// anyone without a subscription. Six upgrade CTAs once pointed there instead of
// at checkout; this keeps the caller set to surfaces a subscriber reaches.
const ALLOWED = [
  "/src/components/mobile/screens/MobileAccountPage.tsx",
  "/src/components/settings/sections/AccountSection.tsx",
];

const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

test("only subscriber-facing surfaces import openPortal", () => {
  const callers = Object.entries(sources)
    .filter(([path]) => path !== "/src/utils/billing.ts" && !/\.test\.tsx?$/.test(path))
    .filter(([, source]) => /from "@\/utils\/billing"/.test(source))
    .map(([path]) => path)
    .sort();

  expect(callers.length).toBeGreaterThan(0);
  expect(callers).toEqual([...ALLOWED].sort());
});
