import { describe, expect, test, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

const { getSshSteps } = await import("./constants");

describe("getSshSteps", () => {
  test("prepends the knocking step only when asked", () => {
    expect(getSshSteps(true)[0].id).toBe("knocking");
    expect(getSshSteps().map((s) => s.id)).not.toContain("knocking");
  });
});
