import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(selectionTargets(s), null);
  assert.equal(hasSelection(s), false);
  for (const k of ALL) {
    assert.equal(handlerActive(k, s), true, `${k} active`);
    assert.equal(selectedIds(k, s), null, `${k} unrestricted`);
    assert.equal(isSingleSelection(k, s), false);
  }
});

test("single-item export targets exactly its own type", () => {
  const s: SelectionProps = { single: { key: "keys", id: "k1" } };
  assert.deepEqual([...selectionTargets(s)!], ["keys"]);
  assert.equal(handlerActive("keys", s), true);
  assert.equal(handlerActive("connections", s), false);
  assert.equal(handlerActive("snippets", s), false);
  assert.deepEqual(selectedIds("keys", s), ["k1"]);
  assert.equal(selectedIds("connections", s), null);
  assert.equal(isSingleSelection("keys", s), true);
  assert.equal(isSingleSelection("identities", s), false);
});

test("bulk snippets export: only snippets active and restricted", () => {
  const s: SelectionProps = { bulk: { snippets: ["s1", "s2", "s3"] } };
  assert.deepEqual([...selectionTargets(s)!], ["snippets"]);
  assert.equal(handlerActive("snippets", s), true);
  assert.equal(handlerActive("connections", s), false);
  assert.deepEqual(selectedIds("snippets", s), ["s1", "s2", "s3"]);
  assert.equal(isSingleSelection("snippets", s), false); // bulk, not single
});

test("keychain bulk: keys AND identities together keep both active", () => {
  const s: SelectionProps = { bulk: { keys: ["k1", "k2"], identities: ["i1"] } };
  assert.deepEqual(new Set(selectionTargets(s)!), new Set(["keys", "identities"]));
  assert.equal(handlerActive("keys", s), true);
  assert.equal(handlerActive("identities", s), true);
  assert.equal(handlerActive("connections", s), false);
  assert.deepEqual(selectedIds("keys", s), ["k1", "k2"]);
  assert.deepEqual(selectedIds("identities", s), ["i1"]);
});

test("empty bulk entries don't count (keys-only passes identities: [])", () => {
  // Empty list must not count as a target, else keys-only export hid everything.
  const s: SelectionProps = { bulk: { keys: ["k1"], identities: [] } };
  assert.deepEqual([...selectionTargets(s)!], ["keys"]);
  assert.equal(handlerActive("keys", s), true);
  assert.equal(handlerActive("identities", s), false);
  assert.deepEqual(selectedIds("keys", s), ["k1"]);
  assert.equal(selectedIds("identities", s), null);
});

test("a bulk object with only empty lists is treated as no selection", () => {
  const s: SelectionProps = { bulk: { connections: [], snippets: [] } };
  assert.equal(selectionTargets(s), null);
  assert.equal(hasSelection(s), false);
  for (const k of ALL) assert.equal(handlerActive(k, s), true, `${k} active`);
});

test("single-item export of a snippet (parity with hosts/keys)", () => {
  const s: SelectionProps = { single: { key: "snippets", id: "s7" } };
  assert.deepEqual([...selectionTargets(s)!], ["snippets"]);
  assert.equal(handlerActive("snippets", s), true);
  assert.equal(handlerActive("connections", s), false);
  assert.equal(handlerActive("keys", s), false);
  assert.deepEqual(selectedIds("snippets", s), ["s7"]);
  assert.equal(isSingleSelection("snippets", s), true);
});

test("single-item export of a connection", () => {
  const s: SelectionProps = { single: { key: "connections", id: "c9" } };
  assert.equal(handlerActive("connections", s), true);
  assert.equal(handlerActive("keys", s), false);
  assert.equal(handlerActive("identities", s), false);
  assert.deepEqual(selectedIds("connections", s), ["c9"]);
  assert.equal(isSingleSelection("connections", s), true);
});
