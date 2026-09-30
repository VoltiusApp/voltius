import { test, expect } from "vitest";
import { vaultsSectionFrom } from "./vaultSection";

test("a team vault travels in settings sync without its name", () => {
  const section = vaultsSectionFrom(
    [{ id: "v1", name: "Prod", updatedAt: "2026-09-30T00:00:00.000Z" }, { id: "v-team", name: "Ops", teamId: "t1", updatedAt: "2026-09-30T00:00:00.000Z" }],
    {},
  );
  expect(section.v1.name).toBe("Prod");
  expect(section["v-team"]).toEqual({ name: "", teamId: "t1", updatedAt: "2026-09-30T00:00:00.000Z" });
});
