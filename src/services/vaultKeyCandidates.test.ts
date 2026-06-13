import { buildDecryptKeyCandidates } from "./vaultKeyCandidates.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

const A = [1, 2, 3];
const B = [4, 5, 6];
const C = [7, 8, 9];

assertEqual(
  buildDecryptKeyCandidates(A, B, C),
  [A, B, C],
  "three distinct keys kept in order vaultKey, kek, dek",
);

assertEqual(
  buildDecryptKeyCandidates(A, B, A), // dek === vaultKey (common post-migration case)
  [A, B],
  "byte-identical key is not tried twice",
);

assertEqual(
  buildDecryptKeyCandidates(A, A, A),
  [A],
  "all-identical collapses to one",
);

assertEqual(
  buildDecryptKeyCandidates(null, B, null),
  [B],
  "null keys are dropped",
);

assertEqual(
  // primary production shape: fresh login has no distinct active vaultKey beyond
  // dek, autoLogin desktop has kek+dek — both keys must be tried.
  buildDecryptKeyCandidates(null, B, C),
  [B, C],
  "kek and dek both kept when active vault key is absent",
);

assertEqual(
  buildDecryptKeyCandidates([], B, C),
  [B, C],
  "empty-array key is dropped",
);

assertEqual(
  buildDecryptKeyCandidates(null, null, null),
  [],
  "all-null yields empty list",
);
