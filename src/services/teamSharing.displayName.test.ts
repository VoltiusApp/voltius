import { test, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { sessionDisplayName } from "./teamSharing";

test("a redacted session falls back to the generic label", () => {
  expect(sessionDisplayName({ connection_name: null })).toBe("hosts.teamSessions.sharedTerminalFallback");
});

test("a visible session shows its own name", () => {
  expect(sessionDisplayName({ connection_name: "prod-db" })).toBe("prod-db");
});
