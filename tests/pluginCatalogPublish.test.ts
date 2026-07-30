import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  FIRST_PARTY_PLUGIN_IDS,
  buildCatalogFragment,
  stageReleaseAssets,
  releaseRepoFor,
} from "../scripts/build-plugins.mjs";
import { sha256Hex } from "../src/plugins/integrity";

const ROOT = path.resolve(__dirname, "..");
const APP_VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Only these two are built for real (one with a stylesheet, one without) — enough
// to prove hashes match real bundler output. The rest get a cheap stand-in index.js
// so buildCatalogFragment can still produce a full six-entry fragment for the
// cardinality/id-correctness assertions, without paying for six vite builds here
// (tests/pluginBundleBuild.test.ts already exercises all six as real builds).
const REAL_BUILDS = ["docker", "monitoring"];

describe("plugin catalogue publish pipeline", () => {
  let outRoot: string;

  // Never write into src-tauri/resources/plugins/ from a test — that path is what
  // `pnpm build` and the Tauri bundler ship, and a prior incident had a test
  // silently overwrite it with broken output while still reporting a pass.
  beforeAll(() => {
    outRoot = mkdtempSync(path.join(tmpdir(), "voltius-plugin-catalog-"));

    for (const id of FIRST_PARTY_PLUGIN_IDS) {
      const dir = path.join(outRoot, id);
      mkdirSync(dir, { recursive: true });
      const manifestSrc = path.join(ROOT, "src/plugins", id, "manifest.json");

      if (REAL_BUILDS.includes(id)) {
        execFileSync(
          "pnpm",
          ["vite", "build", "--config", "vite.plugins.config.ts", "--outDir", dir, "--emptyOutDir"],
          { cwd: ROOT, stdio: "pipe", env: { ...process.env, VOLTIUS_PLUGIN_ID: id } },
        );
      } else {
        writeFileSync(path.join(dir, "index.js"), `// stub for ${id}\n`);
      }
      // vite's --emptyOutDir wipes the dir first, so copy manifest.json after.
      copyFileSync(manifestSrc, path.join(dir, "manifest.json"));
    }
  }, 60000);

  afterAll(() => {
    rmSync(outRoot, { recursive: true, force: true });
  });

  test("every seeded plugin appears exactly once, keyed on its manifest id", () => {
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: APP_VERSION });
    expect(fragment).toHaveLength(FIRST_PARTY_PLUGIN_IDS.length);

    const ids = fragment.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    // TRAP regression: `id` must be the manifest id ("plugin-docker"), never the
    // on-disk folder name ("docker") that FIRST_PARTY_PLUGIN_IDS/build loop use.
    for (const id of ids) {
      expect(id).toMatch(/^plugin-/);
    }
    expect(ids).not.toContain("docker");
    expect(ids.sort()).toEqual(
      ["plugin-docker", "plugin-gist-sync", "plugin-monitoring", "plugin-process-manager", "plugin-proxmox", "plugin-ssh-config"].sort(),
    );
  });

  test("emitted hash matches a fresh sha256 of the actually built index.js", () => {
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: APP_VERSION });
    for (const id of REAL_BUILDS) {
      const manifest = JSON.parse(readFileSync(path.join(outRoot, id, "manifest.json"), "utf8"));
      const entry = fragment.find((p: { id: string }) => p.id === manifest.id);
      expect(entry).toBeDefined();
      const jsText = readFileSync(path.join(outRoot, id, "index.js"), "utf8");
      expect(entry.hash).toBe(sha256(jsText));
    }
  });

  test("cssHash is present only for the plugin that ships a stylesheet", () => {
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: APP_VERSION });
    const monitoring = fragment.find((p: { id: string }) => p.id === "plugin-monitoring");
    const docker = fragment.find((p: { id: string }) => p.id === "plugin-docker");

    expect(existsSync(path.join(outRoot, "monitoring", "voltius.css"))).toBe(true);
    const cssText = readFileSync(path.join(outRoot, "monitoring", "voltius.css"), "utf8");
    expect(monitoring.cssHash).toBe(sha256(cssText));

    expect(existsSync(path.join(outRoot, "docker", "voltius.css"))).toBe(false);
    expect(docker.cssHash).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(docker, "cssHash")).toBe(false);
  });

  test("fragment never carries a builtin field", () => {
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: APP_VERSION });
    for (const entry of fragment) {
      expect(entry).not.toHaveProperty("builtin");
    }
  });

  test("theme is false; version and minAppVersion come from package.json", () => {
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: APP_VERSION });
    for (const entry of fragment) {
      expect(entry.theme).toBe(false);
      expect(entry.version).toBe(APP_VERSION);
      expect(entry.minAppVersion).toBe(APP_VERSION);
    }
  });

  test("stageReleaseAssets writes unprefixed filenames per plugin, under a tmp dir", () => {
    const stageDir = path.join(outRoot, "__staged__");
    const tags = stageReleaseAssets(FIRST_PARTY_PLUGIN_IDS, outRoot, stageDir, APP_VERSION);
    expect(tags).toHaveLength(FIRST_PARTY_PLUGIN_IDS.length);
    expect(new Set(tags).size).toBe(tags.length);

    for (const tag of tags) {
      expect(existsSync(path.join(stageDir, tag, "index.js"))).toBe(true);
      expect(existsSync(path.join(stageDir, tag, "manifest.json"))).toBe(true);
    }
    const monitoringTag = tags.find((t: string) => t.startsWith("plugin-monitoring-"));
    expect(monitoringTag).toBeDefined();
    expect(existsSync(path.join(stageDir, monitoringTag, "voltius.css"))).toBe(true);

    const dockerTag = tags.find((t: string) => t.startsWith("plugin-docker-"));
    expect(existsSync(path.join(stageDir, dockerTag, "voltius.css"))).toBe(false);

    expect(stageDir.startsWith(outRoot)).toBe(true);
  });

  test("releaseRepoFor matches the client's unprefixed fetch pattern", () => {
    const repo = releaseRepoFor("plugin-docker", "9.9.9");
    expect(repo).toBe("https://github.com/VoltiusApp/voltius/releases/download/plugin-docker-v9.9.9");
    // src/stores/marketplaceStore.ts always fetches `${plugin.repo}/index.js` and
    // `${plugin.repo}/manifest.json` verbatim — no per-plugin prefix.
    expect(`${repo}/index.js`).toBe(
      "https://github.com/VoltiusApp/voltius/releases/download/plugin-docker-v9.9.9/index.js",
    );
  });
});

// The client verifies fetched bundles with sha256Hex (src/plugins/integrity.ts),
// computed under Web Crypto in the webview. The publish pipeline computes hashes
// under Node's crypto module. These must agree, or every published entry's `hash`
// would fail verification on install.
describe("hash algorithm parity", () => {
  test("Node's sha256 matches the client's sha256Hex for the same UTF-8 text", async () => {
    const samples = ["", "hello", "// plugin bundle\nexport default {};\n", "☃ unicode"];
    for (const text of samples) {
      expect(sha256(text)).toBe(await sha256Hex(text));
    }
  });
});
