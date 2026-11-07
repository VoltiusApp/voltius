// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import fixture from "../../../src-tauri/src/policy/fixtures/effective.json?raw";
import { boundedValue, effectiveSetting } from "./effective";
import { usePolicyStore } from "@/stores/policyStore";

interface Row {
  name: string;
  key: string;
  range: Record<string, unknown>;
  stored: unknown;
  adminDefault?: unknown;
  builtIn?: unknown;
  expect: unknown;
}

const rows: Row[] = JSON.parse(fixture);
const empty = { policy: {}, defaults: {} };
const withPolicy = (policy: Record<string, unknown>) =>
  usePolicyStore.setState({ machine: { policy, defaults: {} }, server: empty });

const TTL = "appSettings.detachedTtlHours";
const PROXY = "appSettings.proxy";

describe("effective", () => {
  beforeEach(() => usePolicyStore.setState({ machine: empty, server: empty, issues: [] }));

  it("matches the shared fixture", () => {
    for (const r of rows) {
      expect(boundedValue(r.key, r.range, r.stored, r.adminDefault ?? undefined, r.builtIn ?? undefined), r.name).toEqual(r.expect);
    }
  });

  it("lock wins over stored", () => {
    withPolicy({ "appSettings.locale": "fr" });
    expect(effectiveSetting("appSettings.locale", "ru")).toBe("fr");
  });

  it("range removal returns the stored value", () => {
    withPolicy({ [TTL]: { $range: { max: 24 } } });
    expect(effectiveSetting(TTL, 72)).toBe(24);
    withPolicy({});
    expect(effectiveSetting(TTL, 72)).toBe(72);
  });

  it("keyword lock adds admin rules before the user's", () => {
    const admin = { id: "admin", color: "red", words: ["panic"], enabled: true };
    const mine = { id: "mine", color: "green", words: ["ok"], enabled: true };
    withPolicy({ "appSettings.terminal.keywordRules": [admin] });
    expect(effectiveSetting("appSettings.terminal.keywordRules", [mine])).toEqual([admin, mine]);
  });

  it("proxy lock without username keeps the user's username", () => {
    withPolicy({ [PROXY]: { mode: "http", host: "p", port: 1 } });
    expect(effectiveSetting(PROXY, { mode: "none", username: "bob" })).toEqual({ mode: "http", host: "p", port: 1, username: "bob" });
    withPolicy({ [PROXY]: { mode: "system" } });
    expect(effectiveSetting(PROXY, { mode: "none", username: "bob" })).toEqual({ mode: "system" });
  });

  it("location lock fills label and source", () => {
    withPolicy({ "themes.location": { lat: 1, lng: 2 } });
    expect(effectiveSetting("themes.location", null)).toEqual({ label: "manual", source: "manual", lat: 1, lng: 2 });
  });
});
