import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs script without type declarations
import { changelogSection, storeNotes } from "../scripts/store/release-notes.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-10-23

### Added

- You can delete your account from the app. You confirm by typing your email (#705)
- Portuguese, in three variants. Thanks to @someone (#706, #707)

### Changed

- The macOS app is now **notarized** by Apple, see [docs](https://voltius.app/docs) (#704)
- Edge to edge on Android (#666–#669, #673)

## [1.1.0] - 2026-10-22

- Older entry
`;

function awkSection(changelog: string, version: string): string {
  const hdr = `## [${version}]`;
  let flag = false;
  const out: string[] = [];
  for (const line of changelog.split("\n")) {
    if (line.startsWith(hdr)) { flag = true; continue; }
    if (flag && line.startsWith("## ")) flag = false;
    if (flag) out.push(line);
  }
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

describe("changelogSection", () => {
  it("returns the version's section without surrounding blank lines", () => {
    const s = changelogSection(CHANGELOG, "1.2.0");
    expect(s.startsWith("### Added")).toBe(true);
    expect(s.endsWith("(#666–#669, #673)")).toBe(true);
    expect(s).not.toContain("Older entry");
  });

  it("returns null for a missing or empty version", () => {
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
    expect(changelogSection(CHANGELOG, "Unreleased")).toBeNull();
  });

  it("matches the awk extraction release.yml used, on the real changelog", () => {
    const real = readFileSync("CHANGELOG.md", "utf8");
    const versions = [...real.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]).slice(0, 15);
    expect(versions.length).toBeGreaterThan(3);
    for (const v of versions) expect(changelogSection(real, v)).toBe(awkSection(real, v));
  });
});

describe("storeNotes", () => {
  const section = changelogSection(CHANGELOG, "1.2.0");

  it("keeps one plain first sentence per entry", () => {
    expect(storeNotes(section, 500)).toBe(
      [
        "• You can delete your account from the app.",
        "• Portuguese, in three variants.",
        "• The macOS app is now notarized by Apple, see docs",
        "• Edge to edge on Android",
      ].join("\n"),
    );
  });

  it("drops whole entries that do not fit", () => {
    expect(storeNotes(section, 80)).toBe("• You can delete your account from the app.\n• Portuguese, in three variants.");
  });

  it("truncates a single oversized first entry instead of returning nothing", () => {
    const out = storeNotes(section, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("stays within the Play limit for every real release", () => {
    const real = readFileSync("CHANGELOG.md", "utf8");
    for (const [, v] of real.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)) {
      const notes = storeNotes(changelogSection(real, v) ?? "", 500);
      expect(notes.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("CLI", () => {
  it("prints the markdown section, or plain text with a limit", () => {
    const run = (...args: string[]) => execFileSync("node", ["scripts/store/release-notes.mjs", ...args], { encoding: "utf8" });
    const real = readFileSync("CHANGELOG.md", "utf8");
    const v = real.match(/^## \[(\d+\.\d+\.\d+)\]/m)![1];
    expect(run(v).trimEnd()).toBe(changelogSection(real, v));
    expect(run(v, "500").trimEnd()).toBe(storeNotes(changelogSection(real, v), 500));
  });
});
