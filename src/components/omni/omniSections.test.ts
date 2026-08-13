import { test, expect } from "vitest";
import { computeSectionBoundaries } from "./omniSections";

const item = (kind: string, id = "") => ({ kind, id });

test("offsets sections after a leading join-code row", () => {
  const b = computeSectionBoundaries(
    [item("join-code"), item("quick-connect"), item("session"), item("host")],
    0,
  );
  expect(b.joinCodeStart).toBe(0);
  expect(b.joinCodeCount).toBe(1);
  expect(b.quickConnectStart).toBe(1);
  expect(b.activeStart).toBe(2);
  expect(b.hostStart).toBe(3);
});

test("keeps the original offsets when no join-code row is present", () => {
  const b = computeSectionBoundaries([item("quick-connect"), item("session"), item("host")], 0);
  expect(b.joinCodeCount).toBe(0);
  expect(b.quickConnectStart).toBe(0);
  expect(b.activeStart).toBe(1);
  expect(b.hostStart).toBe(2);
});

test("recent hosts are counted out of the host section", () => {
  const b = computeSectionBoundaries([item("host"), item("host"), item("host")], 2);
  expect(b.recentStart).toBe(0);
  expect(b.recentCount).toBe(2);
  expect(b.hostStart).toBe(2);
  expect(b.hostCount).toBe(1);
});

test("settings actions are separated from plain actions", () => {
  const b = computeSectionBoundaries(
    [item("action", "open-settings:general"), item("action", "new-window"), item("toggle")],
    0,
  );
  expect(b.settingsCount).toBe(1);
  expect(b.actionCount).toBe(1);
  expect(b.toggleCount).toBe(1);
});
