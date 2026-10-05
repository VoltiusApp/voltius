// @vitest-environment jsdom
import { test, expect } from "vitest";
import {
  selectionTargets,
  handlerActive,
  selectedIds,
  isSingleSelection,
  hasSelection,
  type SelectionProps,
} from "../src/services/import-export/context.ts";

// Pins the generic selection helpers that every export handler delegates to.

const ALL = ["connections", "identities", "keys", "snippets", "portForwardingRules"];

test("no selection (full export): every type is active, nothing is restricted", () => {
  const s: SelectionProps = {};
  expect(selectionTargets(s)).toBe(null);
  expect(hasSelection(s)).toBe(false);
  for (const k of ALL) {
    expect(handlerActive(k, s), `${k} active`).toBe(true);
    expect(selectedIds(k, s), `${k} unrestricted`).toBe(null);
    expect(isSingleSelection(k, s)).toBe(false);
  }
});

test("single-item export targets exactly its own type", () => {
  const s: SelectionProps = { single: { key: "keys", id: "k1" } };
  expect([...selectionTargets(s)!]).toEqual(["keys"]);
  expect(handlerActive("keys", s)).toBe(true);
  expect(handlerActive("connections", s)).toBe(false);
  expect(handlerActive("snippets", s)).toBe(false);
  expect(selectedIds("keys", s)).toEqual(["k1"]);
  expect(selectedIds("connections", s)).toBe(null);
  expect(isSingleSelection("keys", s)).toBe(true);
  expect(isSingleSelection("identities", s)).toBe(false);
});

test("bulk snippets export: only snippets active and restricted", () => {
  const s: SelectionProps = { bulk: { snippets: ["s1", "s2", "s3"] } };
  expect([...selectionTargets(s)!]).toEqual(["snippets"]);
  expect(handlerActive("snippets", s)).toBe(true);
  expect(handlerActive("connections", s)).toBe(false);
  expect(selectedIds("snippets", s)).toEqual(["s1", "s2", "s3"]);
  expect(isSingleSelection("snippets", s)).toBe(false); // bulk, not single
});

test("keychain bulk: keys AND identities together keep both active", () => {
  const s: SelectionProps = { bulk: { keys: ["k1", "k2"], identities: ["i1"] } };
  expect(new Set(selectionTargets(s)!)).toEqual(new Set(["keys", "identities"]));
  expect(handlerActive("keys", s)).toBe(true);
  expect(handlerActive("identities", s)).toBe(true);
  expect(handlerActive("connections", s)).toBe(false);
  expect(selectedIds("keys", s)).toEqual(["k1", "k2"]);
  expect(selectedIds("identities", s)).toEqual(["i1"]);
});

test("empty bulk entries don't count (keys-only passes identities: [])", () => {
  // Empty list must not count as a target, else keys-only export hid everything.
  const s: SelectionProps = { bulk: { keys: ["k1"], identities: [] } };
  expect([...selectionTargets(s)!]).toEqual(["keys"]);
  expect(handlerActive("keys", s)).toBe(true);
  expect(handlerActive("identities", s)).toBe(false);
  expect(selectedIds("keys", s)).toEqual(["k1"]);
  expect(selectedIds("identities", s)).toBe(null);
});

test("a bulk object with only empty lists is treated as no selection", () => {
  const s: SelectionProps = { bulk: { connections: [], snippets: [] } };
  expect(selectionTargets(s)).toBe(null);
  expect(hasSelection(s)).toBe(false);
  for (const k of ALL) expect(handlerActive(k, s), `${k} active`).toBe(true);
});

test("single-item export of a snippet (parity with hosts/keys)", () => {
  const s: SelectionProps = { single: { key: "snippets", id: "s7" } };
  expect([...selectionTargets(s)!]).toEqual(["snippets"]);
  expect(handlerActive("snippets", s)).toBe(true);
  expect(handlerActive("connections", s)).toBe(false);
  expect(handlerActive("keys", s)).toBe(false);
  expect(selectedIds("snippets", s)).toEqual(["s7"]);
  expect(isSingleSelection("snippets", s)).toBe(true);
});

test("single-item export of a connection", () => {
  const s: SelectionProps = { single: { key: "connections", id: "c9" } };
  expect(handlerActive("connections", s)).toBe(true);
  expect(handlerActive("keys", s)).toBe(false);
  expect(handlerActive("identities", s)).toBe(false);
  expect(selectedIds("connections", s)).toEqual(["c9"]);
  expect(isSingleSelection("connections", s)).toBe(true);
});
