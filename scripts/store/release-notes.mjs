// Release notes from CHANGELOG.md, as the GitHub release body (markdown) or as
// plain store text under a length limit.
//   node scripts/store/release-notes.mjs <version>            markdown section
//   node scripts/store/release-notes.mjs <version> <maxChars> plain store text
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const body = end < 0 ? rest : rest.slice(0, end);
  while (body.length && body[0] === "") body.shift();
  while (body.length && body[body.length - 1] === "") body.pop();
  return body.length ? body.join("\n") : null;
}

const ISSUE_REFS = /\s*\((?:#\d+(?:[–-]#?\d+)?(?:,\s*)?)+\)/g;

function plain(text) {
  return text
    .replace(ISSUE_REFS, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .trim();
}

const firstSentence = (text) => text.split(/(?<=\.)\s+(?=[A-Z])/)[0];

/** One bullet per changelog entry, first sentence only, as many as fit in `limit`. */
export function storeNotes(section, limit) {
  const items = section
    .split("\n")
    .filter((l) => /^\s*[-*] /.test(l))
    .map((l) => `• ${firstSentence(plain(l.replace(/^\s*[-*] /, "")))}`);
  let out = "";
  for (const item of items) {
    const next = out ? `${out}\n${item}` : item;
    if (next.length > limit) break;
    out = next;
  }
  if (!out && items.length) out = `${items[0].slice(0, limit - 1)}…`;
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [version, max] = process.argv.slice(2);
  const section = changelogSection(readFileSync("CHANGELOG.md", "utf8"), version);
  if (!section) {
    console.error(`No CHANGELOG.md section for version ${version}`);
    process.exit(1);
  }
  console.log(max ? storeNotes(section, Number(max)) : section);
}
