import { test, expect } from "vitest";
import { compareVersions, satisfiesMinAppVersion, MinAppVersionError } from "./version";

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

test("MinAppVersionError carries the required and actual versions", () => {
  const err = new MinAppVersionError("2.0.0", "1.9.9");
  expect(err.required).toBe("2.0.0");
  expect(err.actual).toBe("1.9.9");
  expect(err.name).toBe("MinAppVersionError");
});
