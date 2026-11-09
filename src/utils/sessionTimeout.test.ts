import { expect, test } from "vitest";
import { sessionTimeoutLabel } from "./sessionTimeout";

const t = (key: string, options?: { count: number }) => (options ? `${key}:${options.count}` : key);

test("a listed value uses its own label", () => {
  expect(sessionTimeoutLabel(t, "15")).toBe("settings.account.sessionSecurity.timeout.15min");
});

test("an unlisted minute count falls back to the plural minutes label", () => {
  expect(sessionTimeoutLabel(t, "10")).toBe("settings.account.sessionSecurity.timeout.minutes:10");
});
