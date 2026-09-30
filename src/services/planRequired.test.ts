import { test, expect, vi } from "vitest";

const loadTeams = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ loadTeams }) } }));

import { refuseIfPlanRequired } from "./planRequired";

test("a 402 throws the plan error and reloads teams", async () => {
  expect(() => refuseIfPlanRequired(new Response(null, { status: 402 }))).toThrow("common.error.businessPlanRequired");
  await vi.waitFor(() => expect(loadTeams).toHaveBeenCalledTimes(1));
});

test("any other status passes through", () => {
  expect(() => refuseIfPlanRequired(new Response(null, { status: 403 }))).not.toThrow();
  expect(() => refuseIfPlanRequired(new Response(null, { status: 200 }))).not.toThrow();
});
