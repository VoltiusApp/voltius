import { test, expect } from "vitest";
import { copyingRulesOf, rulesSourceOf } from "./ruleSetIntent";

test("the intent travels with the form object and nothing else", () => {
  const form = { name: "web (copy)" };
  expect(copyingRulesOf(form, "src1")).toBe(form);
  expect(rulesSourceOf(form)).toBe("src1");
  expect(rulesSourceOf({ ...form })).toBeUndefined();
});
