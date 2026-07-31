import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Anchor every path to the repo root, not the caller's cwd. Run from anywhere but
// the repo root, a cwd-relative path silently resolves to nothing, every id "skips",
// and this script previously exited 0 having built zero plugins — after which
// `pnpm build` ships a release with no seeded plugins and no failure anywhere.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES_DIR = path.join(ROOT, "src-tauri/resources/plugins");

// These are on-disk FOLDER names (src/plugins/<folder>/), not manifest ids. The
// manifest id (e.g. "plugin-docker") is what the catalogue, tombstones,
// installedMeta and the runtime registry key on — see buildCatalogFragment below.
export const FIRST_PARTY_PLUGIN_IDS = [
  "ssh-config",
  "gist-sync",
  "monitoring",
  "docker",
  "process-manager",
  "proxmox",
];

// owner/repo hosting the per-plugin release tags computed by releaseRepoFor. Falls
// back to the hardcoded slug when not running in GitHub Actions (GITHUB_REPOSITORY
// unset), e.g. for local `--emit-catalog` runs.
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || "VoltiusApp/voltius";

const PLUGIN_TAGS = {
  "ssh-config": ["sync", "ssh"],
  "gist-sync": ["sync", "github"],
  monitoring: ["monitoring", "metrics"],
  docker: ["docker", "containers"],
  "process-manager": ["system", "processes"],
  proxmox: ["proxmox", "virtualization"],
};

function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Builds each folder id in `ids` via vite, into src-tauri/resources/plugins/<id>. */
export function buildPlugins(ids) {
  let built = 0;
  for (const id of ids) {
    const manifestPath = path.join(ROOT, "src/plugins", id, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`[build-plugins] "${id}" has no manifest.json at ${manifestPath}`);
    }
    execFileSync("pnpm", ["vite", "build", "--config", "vite.plugins.config.ts"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, VOLTIUS_PLUGIN_ID: id },
    });
    const dir = path.join(ROOT, "src-tauri/resources/plugins", id);
    mkdirSync(dir, { recursive: true });
    copyFileSync(manifestPath, path.join(dir, "manifest.json"));
    built += 1;
  }
  return built;
}

// The marketplace client always fetches `${plugin.repo}/index.js` unprefixed
// (src/stores/marketplaceStore.ts), so each plugin gets its own release rather than
// sharing one with prefixed asset names.
export function releaseTagFor(manifestId, pluginVersion) {
  return `${manifestId}-v${pluginVersion}`;
}

export function releaseRepoFor(manifestId, pluginVersion) {
  return `https://github.com/${GITHUB_REPO}/releases/download/${releaseTagFor(manifestId, pluginVersion)}`;
}

/**
 * Build a marketplace catalogue fragment (MarketplacePlugin[] shape, minus `sourceId`
 * which fetchCatalog assigns at fetch time) for already-built bundles under
 * `resourcesDir`.
 *
 * TRAP: `ids` here are on-disk FOLDER names ("docker"), but every emitted `id` is the
 * MANIFEST id ("plugin-docker") read out of that folder's manifest.json — never the
 * folder name itself. Getting this backwards makes every entry unmatchable against
 * tombstones, installedMeta, and the runtime registry, which all key on the manifest id.
 */
export function buildCatalogFragment(ids, { resourcesDir = RESOURCES_DIR, appVersion }) {
  return ids.map((folder) => {
    const dir = path.join(resourcesDir, folder);
    const manifest = readManifest(dir);
    const jsText = readFileSync(path.join(dir, "index.js"), "utf8");
    const cssPath = path.join(dir, "voltius.css");

    const entry = {
      id: manifest.id,
      name: manifest.name,
      author: "Voltius",
      description: manifest.description ?? "",
      repo: releaseRepoFor(manifest.id, manifest.version),
      version: manifest.version,
      minAppVersion: manifest.minAppVersion ?? appVersion,
      tags: PLUGIN_TAGS[folder] ?? [],
      theme: false,
      hash: sha256(jsText),
    };
    if (existsSync(cssPath)) {
      entry.cssHash = sha256(readFileSync(cssPath, "utf8"));
    }
    return entry;
  });
}

/**
 * Stage each plugin's built bundle into its own `<manifest-id>-v<pluginVersion>/`
 * subdirectory under `stageDir`, using UNPREFIXED filenames (index.js,
 * manifest.json, voltius.css) — see releaseRepoFor for why. CI uploads each
 * subdirectory as the asset set of its own like-named GitHub Release. The tag is
 * keyed on each plugin's OWN manifest version, not the app version, so a plugin
 * fix republishes under its own tag without a full app release.
 */
export function stageReleaseAssets(ids, resourcesDir, stageDir) {
  const tags = [];
  for (const folder of ids) {
    const srcDir = path.join(resourcesDir, folder);
    const manifest = readManifest(srcDir);
    const tag = releaseTagFor(manifest.id, manifest.version);
    const destDir = path.join(stageDir, tag);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(path.join(srcDir, "manifest.json"), path.join(destDir, "manifest.json"));
    copyFileSync(path.join(srcDir, "index.js"), path.join(destDir, "index.js"));
    const cssPath = path.join(srcDir, "voltius.css");
    if (existsSync(cssPath)) {
      copyFileSync(cssPath, path.join(destDir, "voltius.css"));
    }
    tags.push(tag);
  }
  return tags;
}

function readAppVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

function parseArgs(argv) {
  const flags = {};
  const ids = [];
  for (const arg of argv) {
    const m = arg.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) {
      flags[m[1]] = m[2] ?? true;
    } else {
      ids.push(arg);
    }
  }
  return { flags, ids };
}

/** Resolves a `--flag[=value]` path argument, rejecting an explicit empty value
 *  (`--flag=`) rather than silently falling back to the default — the default is
 *  for an omitted flag, not a mistyped one. */
function resolveFlagPath(flags, name, defaultRelPath) {
  const raw = flags[name];
  if (raw === "") {
    throw new Error(`[build-plugins] --${name}= was given an empty value — omit it to use the default, or pass a path`);
  }
  return path.resolve(ROOT, typeof raw === "string" ? raw : defaultRelPath);
}

function main() {
  const { flags, ids } = parseArgs(process.argv.slice(2));
  const targetIds = ids.length ? ids : FIRST_PARTY_PLUGIN_IDS;

  const built = buildPlugins(targetIds);
  console.log(`[build-plugins] built ${built} of ${targetIds.length}`);
  if (built === 0) {
    throw new Error("[build-plugins] built 0 plugins — refusing to exit 0 as if this succeeded");
  }
  if (built !== targetIds.length) {
    throw new Error(`[build-plugins] built ${built} of ${targetIds.length} — expected all of them`);
  }

  if ("emit-catalog" in flags) {
    const outPath = resolveFlagPath(flags, "emit-catalog", "dist/plugin-catalog.json");
    const fragment = buildCatalogFragment(targetIds, { appVersion: readAppVersion() });
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(fragment, null, 2) + "\n");
    console.log(`[build-plugins] wrote catalogue fragment (${fragment.length} entries) to ${outPath}`);
  }

  if ("stage-assets" in flags) {
    const stageDir = resolveFlagPath(flags, "stage-assets", "dist/plugin-release-assets");
    const tags = stageReleaseAssets(targetIds, RESOURCES_DIR, stageDir);
    console.log(`[build-plugins] staged release assets under ${stageDir}:\n  ${tags.join("\n  ")}`);
  }
}

// True when this file is the CLI entry point (`node build-plugins.mjs`), false when
// it's only imported (e.g. by a test, for buildCatalogFragment/stageReleaseAssets).
// Node resolves process.argv[1] to an absolute filesystem path — comparing it
// against the percent-encoded `import.meta.url` (as this used to) breaks on any
// path containing a space, and never matches at all on Windows (`file:///C:/...`
// with forward slashes vs argv[1]'s `C:\...`). import.meta.filename is the same
// absolute-path form process.argv[1] already is, on every platform.
export function isCliEntryPoint(metaFilename, argv1) {
  return metaFilename === argv1;
}

if (isCliEntryPoint(import.meta.filename, process.argv[1])) {
  main();
}
