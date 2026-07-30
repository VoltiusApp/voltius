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

// The marketplace client always fetches `${plugin.repo}/index.js` and
// `${plugin.repo}/manifest.json` verbatim (src/stores/marketplaceStore.ts) — there is
// no per-plugin filename prefix in that fetch. A single shared GitHub Release holding
// all six bundles under prefixed names (`<id>-index.js`, ...) can't be pointed at by
// `repo`, because GitHub's release-asset URLs are flat (`/releases/download/<tag>/
// <asset>`, no subpaths) and only one asset per release may be literally named
// "index.js". Each plugin instead gets its own release, tagged with its manifest id
// and the app version, holding three UNPREFIXED assets — that sidesteps the six-way
// collision while still matching the client's fixed fetch. See task-6-report.md for
// the full writeup of this tradeoff against the brief's literal prefixed-name text.
export function releaseRepoFor(manifestId, appVersion) {
  return `https://github.com/${GITHUB_REPO}/releases/download/${manifestId}-v${appVersion}`;
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
      repo: releaseRepoFor(manifest.id, appVersion),
      version: appVersion,
      minAppVersion: appVersion,
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
 * Stage each plugin's built bundle into its own `<manifest-id>-v<appVersion>/`
 * subdirectory under `stageDir`, using UNPREFIXED filenames (index.js,
 * manifest.json, voltius.css) — see releaseRepoFor for why. CI uploads each
 * subdirectory as the asset set of its own like-named GitHub Release.
 */
export function stageReleaseAssets(ids, resourcesDir, stageDir, appVersion) {
  const tags = [];
  for (const folder of ids) {
    const srcDir = path.join(resourcesDir, folder);
    const manifest = readManifest(srcDir);
    const tag = `${manifest.id}-v${appVersion}`;
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

function main() {
  const { flags, ids } = parseArgs(process.argv.slice(2));
  const targetIds = ids.length ? ids : FIRST_PARTY_PLUGIN_IDS;

  const built = buildPlugins(targetIds);
  console.log(`[build-plugins] built ${built} of ${targetIds.length}`);
  if (built !== targetIds.length) {
    throw new Error(`[build-plugins] built ${built} of ${targetIds.length} — expected all of them`);
  }

  if (flags["emit-catalog"]) {
    const outPath = path.resolve(
      ROOT,
      typeof flags["emit-catalog"] === "string" ? flags["emit-catalog"] : "dist/plugin-catalog.json",
    );
    const fragment = buildCatalogFragment(targetIds, { appVersion: readAppVersion() });
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(fragment, null, 2) + "\n");
    console.log(`[build-plugins] wrote catalogue fragment (${fragment.length} entries) to ${outPath}`);
  }

  if (flags["stage-assets"]) {
    const stageDir = path.resolve(
      ROOT,
      typeof flags["stage-assets"] === "string" ? flags["stage-assets"] : "dist/plugin-release-assets",
    );
    const tags = stageReleaseAssets(targetIds, RESOURCES_DIR, stageDir, readAppVersion());
    console.log(`[build-plugins] staged release assets under ${stageDir}:\n  ${tags.join("\n  ")}`);
  }
}

// Guarded so tests can import buildCatalogFragment/stageReleaseAssets without
// triggering a full six-plugin vite build as an import side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
