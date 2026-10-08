import { expect, test } from "vitest";
import deviconPlain from "virtual:devicon-plain-subset";
import { DEVICON_PLAIN_NAMES } from "./deviconPlainNames";

test("the devicon-plain subset carries exactly the listed icons at the set's size", () => {
  expect(deviconPlain.prefix).toBe("devicon-plain");
  expect(Object.keys(deviconPlain.icons).sort()).toEqual([...DEVICON_PLAIN_NAMES].sort());
  expect([deviconPlain.width, deviconPlain.height]).toEqual([128, 128]);
});
