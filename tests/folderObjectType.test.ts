import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A form's folder fields must create — and offer — folders of the type the page
 * listing that object filters on, or the new folder lands on a different page
 * and the object looks unfiled. KeyForm and IdentityForm were copy-pasted from
 * the connection forms and created `"connection"` folders, which KeychainPage —
 * filtering on `"keychain"` — never shows.
 *
 * Asserted against source text rather than a render: the type is a prop threaded
 * into shared JSX with no seam to invoke, and a full render harness for these
 * forms costs far more than the invariant is worth. This catches the copy-paste,
 * not the runtime behaviour.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const SHARED = "src/components/shared/vaultObjectForm.tsx";

/** The four forms that take their folder type from the shared form chrome, with
 *  the file that declares it — the connection pair share one wrapper hook. */
const SHELL_FORMS: [file: string, expected: string, shellFile: string][] = [
  ["src/components/keychain/KeyForm.tsx", "keychain", "src/components/keychain/KeyForm.tsx"],
  ["src/components/keychain/IdentityForm.tsx", "keychain", "src/components/keychain/IdentityForm.tsx"],
  ["src/components/connections/ConnectionForm.tsx", "connection", "src/components/connections/formShared.tsx"],
  ["src/components/connections/SerialConnectionForm.tsx", "connection", "src/components/connections/formShared.tsx"],
];

test.each(SHELL_FORMS)("%s asks the shared shell for its own folder type", (_file, expected, shellFile) => {
  expect(read(shellFile)).toContain(`folderType: "${expected}"`);
});

test.each(SHELL_FORMS)("%s renders its folder fields with its own folder type", (file, expected) => {
  expect(read(file)).toContain(`folderType="${expected}"`);
});

/** Snippets keep their own form (separate store), so the literal stays there. */
test("SnippetForm creates folders its own page can show", () => {
  const call = /saveFolder\(\{[^}]*object_type:\s*"([a-z_]+)"/.exec(
    read("src/components/snippets/SnippetForm.tsx"),
  );
  expect(call, "no saveFolder({ object_type: … }) found in SnippetForm").not.toBeNull();
  expect(call![1]).toBe("snippet");
});

/** Both halves of the class now live in one place: what the shared fields create,
 *  and what the shared shell offers. */
test("the shared form chrome creates and offers the caller's folder type", () => {
  const src = read(SHARED);
  expect(src).toContain("folderOptionsFor(folders, folderType)");
  expect(src).toMatch(/saveFolder\(\{ name, object_type: folderType/);
});

/** The pages these folders have to appear on, pinned so a page-side rename of
 *  the filter cannot silently strand the forms again. */
test.each([
  ["src/components/keychain/KeychainPage.tsx", "keychain"],
  ["src/components/hosts/HostsPage.tsx", "connection"],
])("%s filters folders on its own object type", (file, expected) => {
  expect(read(file)).toContain(`useScopedFolders(folders, accessibleVaultIds, "${expected}")`);
});
