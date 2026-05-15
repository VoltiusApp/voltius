import test from "node:test";
import assert from "node:assert/strict";
import { getHostDeleteTargetIds } from "../src/components/hosts/hostSelection.ts";

test("deletes all selected hosts when deleting a selected host in a multi-selection", () => {
  assert.deepEqual(
    getHostDeleteTargetIds("host-2", new Set(["host-1", "host-2", "folder-1"]), ["host-1", "host-2"]),
    ["host-1", "host-2"],
  );
});

test("deletes only the clicked host when it is not part of the multi-selection", () => {
  assert.deepEqual(
    getHostDeleteTargetIds("host-3", new Set(["host-1", "host-2"]), ["host-1", "host-2"]),
    ["host-3"],
  );
});

test("deletes only the clicked host when fewer than two hosts are selected", () => {
  assert.deepEqual(
    getHostDeleteTargetIds("host-1", new Set(["host-1", "folder-1"]), ["host-1"]),
    ["host-1"],
  );
});
