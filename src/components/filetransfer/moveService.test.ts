// @vitest-environment jsdom
import { test } from "vitest";
import { runIntraPaneMove } from "./moveService.ts";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import type { PendingTransferAction } from "@/stores/transferQueueStore";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
}

const f = (name: string): FileEntry => ({ name, path: `/src/${name}`, size: 1, isDir: false, isSymlink: false });

function makeOps(existing: Set<string>) {
  const renamed: Array<[string, string]> = [];
  const deleted: string[] = [];
  let pending: PendingTransferAction | null = null;
  let refreshed = 0;
  const ops = {
    exists: async (p: string) => existing.has(p),
    del: async (p: string) => { deleted.push(p); },
    rename: async (from: string, to: string) => { renamed.push([from, to]); },
    setPending: (p: PendingTransferAction | null) => { pending = p; },
    onRefresh: () => { refreshed++; },
  };
  return { ops, renamed, deleted, get pending() { return pending; }, get refreshed() { return refreshed; } };
}

test("runIntraPaneMove no conflict renames all and refreshes", async () => {
  const h = makeOps(new Set());
  await runIntraPaneMove([f("a.txt"), f("b.txt")], "/dest", h.ops);
  assertEqual(h.renamed, [["/src/a.txt", "/dest/a.txt"], ["/src/b.txt", "/dest/b.txt"]], "renames both");
  assertEqual(h.deleted, [], "no deletes");
  assertEqual(h.pending, null, "no pending dialog");
  assertEqual(h.refreshed, 1, "refreshed once");
});

test("runIntraPaneMove queues conflicts and overwrite deletes then renames", async () => {
  const h = makeOps(new Set(["/dest/a.txt"])); // a.txt already exists at dest
  await runIntraPaneMove([f("a.txt"), f("b.txt")], "/dest", h.ops);
  // b.txt has no conflict, a.txt does -> pending raised, nothing moved yet
  assertEqual(h.renamed, [], "nothing moved before resolution");
  if (!h.pending) throw new Error("expected pending");
  assertEqual(h.pending.conflicts.map((c) => c.name), ["a.txt"], "a.txt is the conflict");
  assertEqual(h.pending.toTransfer.map((c) => c.name), ["b.txt"], "b.txt is non-conflicting");
  assertEqual(h.pending.totalConflicts, 1, "one conflict");
  // simulate user choosing overwrite-all -> execute gets both
  h.pending.execute([h.pending.toTransfer[0], h.pending.conflicts[0]]);
  await new Promise((r) => setTimeout(r, 0));
  assertEqual(h.deleted, ["/dest/a.txt"], "existing target deleted before overwrite");
  assertEqual(h.renamed, [["/src/b.txt", "/dest/b.txt"], ["/src/a.txt", "/dest/a.txt"]], "both renamed in chosen order");
});

test("runIntraPaneMove skips a self-move even when overwrite is chosen", async () => {
  // Defensive: a destination equal to the source (from === to) must never hit
  // the delete-then-rename path, which would self-delete the item. (from===to
  // makes the destination "exist", so it is raised as a conflict first.)
  const h = makeOps(new Set(["/src/a.txt"])); // target dir is the item's own dir
  await runIntraPaneMove([f("a.txt")], "/src", h.ops);
  if (!h.pending) throw new Error("expected pending (self path reported as existing)");
  h.pending.execute([h.pending.conflicts[0]]); // user picks overwrite
  await new Promise((r) => setTimeout(r, 0));
  assertEqual(h.deleted, [], "no delete for self-move");
  assertEqual(h.renamed, [], "no rename for self-move");
});
