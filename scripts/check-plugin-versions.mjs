#!/usr/bin/env node
// Pre-flight for the hash guard in .github/workflows/publish-plugins.yml.
//
// That guard is the authoritative one: it compares the FRESHLY BUILT bytes of a
// plugin against the bytes already attached to its published release, and fails
// when they differ. It can only run after a build, and in release.yml it runs
// after `tag` has made the version tag immutable — far too late to amend.
//
// This is the cheap proxy that runs in ci instead: source changed under
// src/plugins/<id>/ since that plugin's last published tag + manifest version
// unchanged. It is not byte-exact (a source edit can be a no-op for the bundler,
// and a dependency bump outside the plugin folder can change the bytes without
// tripping this), so it never replaces the release-time guard — it just moves the
// common case to PR review, where bumping the manifest is still a one-line fix.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_PARTY_PLUGIN_IDS, releaseTagFor } from "./build-plugins.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Nothing under a plugin folder that matches this reaches the published bundle,
// so a change to it cannot make the built bytes diverge from the release.
const NON_BUNDLED = /(^|\/)[^/]*\.(test|spec)\.[jt]sx?$/;

export function isBundledSource(relPath) {
  return !NON_BUNDLED.test(relPath);
}

/**
 * Pure decision for one plugin. Returns null when it is fine, or a violation.
 *
 * @param {{folderId: string, manifestId: string, version: string,
 *          publishedTags: string[], changedFiles: string[]}} input
 */
export function violationFor({ folderId, manifestId, version, publishedTags, changedFiles }) {
  const tag = releaseTagFor(manifestId, version);
  // No release for this version yet: whatever changed will ship as new bytes
  // under a new tag, which is exactly what a version bump is for.
  if (!publishedTags.includes(tag)) return null;
  const files = changedFiles.filter(isBundledSource);
  if (files.length === 0) return null;
  return { folderId, manifestId, version, tag, files };
}

export function formatViolation(v) {
  return (
    `${v.manifestId}: source under src/plugins/${v.folderId}/ changed since the published ` +
    `release '${v.tag}', but manifest.json still says version ${v.version}. ` +
    `Publishing would overwrite bytes the live marketplace catalogue pins a hash to. ` +
    `Bump the 'version' field in src/plugins/${v.folderId}/manifest.json.\n` +
    v.files.map((f) => `    changed: ${f}`).join("\n")
  );
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function listPublishedTags() {
  return git(["tag", "--list", "plugin-*-v*"])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function changedSince(tag, folderId) {
  // Two-dot: tree-vs-tree. The published bytes came from the tag's tree, so the
  // merge base is irrelevant here — what matters is how HEAD differs from what
  // was actually released.
  return git(["diff", "--name-only", `${tag}..HEAD`, "--", `src/plugins/${folderId}/`])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const publishedTags = listPublishedTags();
  if (publishedTags.length === 0) {
    // A shallow or tagless clone makes every tag look unpublished, which would
    // turn this check into a silent no-op. Fail instead.
    console.error(
      "check-plugin-versions: no plugin-*-v* tags visible. Fetch tags (checkout with fetch-depth: 0) before running this check.",
    );
    process.exit(2);
  }

  const violations = [];
  for (const folderId of FIRST_PARTY_PLUGIN_IDS) {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "src/plugins", folderId, "manifest.json"), "utf8"),
    );
    const tag = releaseTagFor(manifest.id, manifest.version);
    const changedFiles = publishedTags.includes(tag) ? changedSince(tag, folderId) : [];
    const v = violationFor({
      folderId,
      manifestId: manifest.id,
      version: manifest.version,
      publishedTags,
      changedFiles,
    });
    if (v) violations.push(v);
  }

  if (violations.length > 0) {
    for (const v of violations) console.error(`::error::${formatViolation(v)}`);
    process.exit(1);
  }
  console.log(`check-plugin-versions: all ${FIRST_PARTY_PLUGIN_IDS.length} plugins OK.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
