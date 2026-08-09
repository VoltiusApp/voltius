import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A form's inline `onCreateFolder` must create a folder of the type the page
 * listing that object filters on, or the new folder lands on a different page
 * and the object looks unfiled. KeyForm and IdentityForm were copy-pasted from
 * the connection forms and created `"connection"` folders, which KeychainPage —
 * filtering on `"keychain"` — never shows.
 *
 * Asserted against source text rather than a render: the call is an inline
 * closure inside JSX with no seam to invoke, and a full render harness for
 * these forms costs far more than the invariant is worth. This catches the
 * copy-paste, not the runtime behaviour.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const CREATORS: [file: string, expected: string][] = [
  ["src/components/keychain/KeyForm.tsx", "keychain"],
  ["src/components/keychain/IdentityForm.tsx", "keychain"],
  ["src/components/connections/ConnectionForm.tsx", "connection"],
  ["src/components/connections/SerialConnectionForm.tsx", "connection"],
  ["src/components/snippets/SnippetForm.tsx", "snippet"],
];

test.each(CREATORS)("%s creates folders its own page can show", (file, expected) => {
  const src = read(file);
  const call = /saveFolder\(\{[^}]*object_type:\s*"([a-z_]+)"/.exec(src);
  expect(call, `no saveFolder({ object_type: … }) found in ${file}`).not.toBeNull();
  expect(call![1]).toBe(expected);
});

/** The pages these folders have to appear on, pinned so a page-side rename of
 *  the filter cannot silently strand the forms again. */
test.each([
  ["src/components/keychain/KeychainPage.tsx", "keychain"],
  ["src/components/hosts/HostsPage.tsx", "connection"],
])("%s filters folders on its own object type", (file, expected) => {
  expect(read(file)).toContain(`useScopedFolders(folders, accessibleVaultIds, "${expected}")`);
});

/** The same class on the read side: `useFolderStore` holds every object type, so
 *  a form handed the raw list offers the other pages' folders. Each form has to
 *  narrow it to its own type before passing it to FolderSelector. */
test.each(CREATORS.filter(([f]) => !f.includes("SnippetForm")))(
  "%s only offers folders of its own object type",
  (file, expected) => {
    expect(read(file)).toContain(`folderOptionsFor(folders, "${expected}")`);
  },
);
