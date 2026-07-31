import { test, expect } from "vitest";
import { compareVersions, satisfiesMinAppVersion, beatsSeededVersion, MinAppVersionError } from "./version";

test("compareVersions: equal versions", () => {
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
});

test("compareVersions: patch ordering", () => {
  expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
  expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
});

test("compareVersions: minor ordering", () => {
  expect(compareVersions("1.2.0", "1.3.0")).toBe(-1);
  expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
});

test("compareVersions: major ordering", () => {
  expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
  expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
});

test("compareVersions: ignores a leading v", () => {
  expect(compareVersions("v1.0.0", "1.0.1")).toBe(-1);
});

test("compareVersions: treats a missing segment as 0", () => {
  expect(compareVersions("1", "1.0.0")).toBe(0);
  expect(compareVersions("1.2", "1.2.0")).toBe(0);
  expect(compareVersions("1.2", "1.2.1")).toBe(-1);
});

test("compareVersions: a prerelease sorts below the same release", () => {
  expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
});

test("satisfiesMinAppVersion: true when minAppVersion is absent", () => {
  expect(satisfiesMinAppVersion({}, "1.0.0")).toBe(true);
  expect(satisfiesMinAppVersion({ minAppVersion: undefined }, "1.0.0")).toBe(true);
});

test("satisfiesMinAppVersion: true when the app is at or above the requirement", () => {
  expect(satisfiesMinAppVersion({ minAppVersion: "1.2.0" }, "1.2.0")).toBe(true);
  expect(satisfiesMinAppVersion({ minAppVersion: "1.2.0" }, "1.3.0")).toBe(true);
});

test("satisfiesMinAppVersion: false when the app is below the requirement", () => {
  expect(satisfiesMinAppVersion({ minAppVersion: "2.0.0" }, "1.9.9")).toBe(false);
});

test("satisfiesMinAppVersion: fails open on an unparseable minAppVersion", () => {
  expect(satisfiesMinAppVersion({ minAppVersion: "not-a-version" }, "1.0.0")).toBe(true);
  expect(satisfiesMinAppVersion({ minAppVersion: "" }, "1.0.0")).toBe(true);
});

test("beatsSeededVersion: true when the candidate is strictly newer", () => {
  expect(beatsSeededVersion("1.2.0", "1.1.0")).toBe(true);
});

test("beatsSeededVersion: false on a tie", () => {
  expect(beatsSeededVersion("1.1.0", "1.1.0")).toBe(false);
});

test("beatsSeededVersion: false when the candidate is older", () => {
  expect(beatsSeededVersion("1.0.0", "1.1.0")).toBe(false);
});

test("beatsSeededVersion: a same-release prerelease candidate does not beat the seeded release", () => {
  expect(beatsSeededVersion("1.2.0-beta.1", "1.2.0")).toBe(false);
});

test("beatsSeededVersion: a prerelease candidate beats an older seeded release", () => {
  expect(beatsSeededVersion("1.2.0-beta.1", "1.1.0")).toBe(true);
});

test("beatsSeededVersion: false when the candidate is unparseable, regardless of the seeded side", () => {
  expect(beatsSeededVersion("not-a-version", "1.1.0")).toBe(false);
  expect(beatsSeededVersion("not-a-version", "garbage")).toBe(false);
});

test("beatsSeededVersion: false when the seeded version is unparseable, even if the candidate is a real, higher version", () => {
  expect(beatsSeededVersion("1.0.0", "garbage")).toBe(false);
  expect(beatsSeededVersion("9.9.9", "")).toBe(false);
});

test("beatsSeededVersion: false when either side is missing or non-string, never throws", () => {
  expect(beatsSeededVersion(undefined, "1.1.0")).toBe(false);
  expect(beatsSeededVersion(null, "1.1.0")).toBe(false);
  expect(beatsSeededVersion(3, "1.1.0")).toBe(false);
  expect(beatsSeededVersion({}, "1.1.0")).toBe(false);
  expect(beatsSeededVersion([], "1.1.0")).toBe(false);
  expect(beatsSeededVersion("1.2.0", undefined)).toBe(false);
  expect(beatsSeededVersion("1.2.0", null)).toBe(false);
  expect(beatsSeededVersion("1.2.0", 3)).toBe(false);
});

test("MinAppVersionError carries the required and actual versions", () => {
  const err = new MinAppVersionError("2.0.0", "1.9.9");
  expect(err.required).toBe("2.0.0");
  expect(err.actual).toBe("1.9.9");
  expect(err.name).toBe("MinAppVersionError");
});
