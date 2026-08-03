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
  releaseTagFor,
  isCliEntryPoint,
  pruneTargets,
} from "../scripts/build-plugins.mjs";
import { sha256Hex } from "../src/plugins/integrity";

const ROOT = path.resolve(__dirname, "..");
const APP_VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Read rather than pin: a plugin's version bumps whenever its source changes, and
// pinned literals here have gone red on a release twice.
function manifestVersion(id: string): string {
  return JSON.parse(readFileSync(path.join(ROOT, "src/plugins", id, "manifest.json"), "utf8")).version;
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

  test("theme is false on every entry", () => {
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: APP_VERSION });
    for (const entry of fragment) {
      expect(entry.theme).toBe(false);
    }
  });

  // All six manifests declare minAppVersion, so the app-version fallback is no
  // longer reachable through them. Asserting `minAppVersion === APP_VERSION` over
  // the real manifests (as this used to) only passed while the two happened to be
  // the same string, and silently stopped testing the fallback at all — it broke
  // the moment the manifests were stamped, and would have broken again on the next
  // app bump. Each case now gets its own manifest.
  test("minAppVersion comes from the manifest when it declares one", () => {
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: "9.9.9" });
    for (const folder of FIRST_PARTY_PLUGIN_IDS) {
      const manifest = JSON.parse(readFileSync(path.join(outRoot, folder, "manifest.json"), "utf8"));
      const entry = fragment.find((p: { id: string }) => p.id === manifest.id);
      expect(manifest.minAppVersion, `${folder} declares no minAppVersion`).toBeTruthy();
      expect(entry.minAppVersion).toBe(manifest.minAppVersion);
      expect(entry.minAppVersion).not.toBe("9.9.9");
    }
  });

  test("minAppVersion falls back to the app version when the manifest omits it", () => {
    const bare = mkdtempSync(path.join(tmpdir(), "voltius-plugin-catalog-bare-"));
    try {
      const dir = path.join(bare, "docker");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "index.js"), "// stub\n");
      const manifest = JSON.parse(
        readFileSync(path.join(outRoot, "docker", "manifest.json"), "utf8"),
      );
      delete manifest.minAppVersion;
      writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));

      const [entry] = buildCatalogFragment(["docker"], { resourcesDir: bare, appVersion: "9.9.9" });
      expect(entry.minAppVersion).toBe("9.9.9");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });


  // Fails under the old behaviour, which stamped `version` from the app version
  // regardless of the plugin's own manifest. The app version is supplied here as a
  // literal that no manifest carries, rather than read from package.json and pinned
  // to the release of the day — pinning it (`expect(APP_VERSION).toBe("0.13.0")`)
  // made this test fail on every version bump, which is exactly what it did on 0.14.0.
  test("fragment version tracks each plugin's own manifest version, not the app version", () => {
    const appVersion = "9.9.9";
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion });
    const docker = fragment.find((p: { id: string }) => p.id === "plugin-docker");
    const monitoring = fragment.find((p: { id: string }) => p.id === "plugin-monitoring");

    expect(docker.version).toBe(manifestVersion("docker"));
    expect(monitoring.version).toBe(manifestVersion("monitoring"));
    for (const entry of fragment) {
      expect(entry.version).not.toBe(appVersion);
    }
  });

  // Fix 3 (publish pipeline): the plugin-only publish path passes no `appVersion`
  // fallback at all, so a manifest that omits minAppVersion must fail loudly rather
  // than silently resolve to `undefined` — a bad catalogue entry would otherwise
  // exclude every user until someone notices.
  test("throws naming the plugin when appVersion is omitted and the manifest has no minAppVersion", () => {
    const folder = "__no-min-app-version__";
    const dir = path.join(outRoot, folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ id: "plugin-no-floor", name: "NoFloor", version: "3.0.0" }),
    );
    writeFileSync(path.join(dir, "index.js"), "// fixture\n");

    expect(() => buildCatalogFragment([folder], { resourcesDir: outRoot, appVersion: undefined }))
      .toThrow(/plugin-no-floor/);
  });

  test("succeeds with no appVersion fallback when the manifest supplies its own minAppVersion", () => {
    const folder = "__self-sufficient-min-app-version__";
    const dir = path.join(outRoot, folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ id: "plugin-self-sufficient", name: "SelfSufficient", version: "3.0.0", minAppVersion: "0.14.0" }),
    );
    writeFileSync(path.join(dir, "index.js"), "// fixture\n");

    const fragment = buildCatalogFragment([folder], { resourcesDir: outRoot, appVersion: undefined });
    expect(fragment[0].minAppVersion).toBe("0.14.0");
  });

  test("minAppVersion honours an explicit manifest field over the app-version fallback", () => {
    const folder = "__with-min-app-version__";
    const dir = path.join(outRoot, folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ id: "plugin-fixture", name: "Fixture", version: "2.0.0", minAppVersion: "0.10.0" }),
    );
    writeFileSync(path.join(dir, "index.js"), "// fixture\n");

    const fragment = buildCatalogFragment([folder], { resourcesDir: outRoot, appVersion: APP_VERSION });
    expect(fragment[0].minAppVersion).toBe("0.10.0");
    expect(fragment[0].minAppVersion).not.toBe(APP_VERSION);
    expect(fragment[0].version).toBe("2.0.0");
  });

  test("stageReleaseAssets writes unprefixed filenames per plugin, under a tmp dir", () => {
    const stageDir = path.join(outRoot, "__staged__");
    const tags = stageReleaseAssets(FIRST_PARTY_PLUGIN_IDS, outRoot, stageDir);
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

    // The tag embeds the PLUGIN's own version, not the app version.
    expect(dockerTag).toBe(`plugin-docker-v${manifestVersion("docker")}`);
    expect(monitoringTag).toBe(`plugin-monitoring-v${manifestVersion("monitoring")}`);

    expect(stageDir.startsWith(outRoot)).toBe(true);
  });

  test("releaseRepoFor and stageReleaseAssets agree on the release tag", () => {
    // Highest-risk invariant: if these two ever disagree, the catalogue's `repo`
    // points at a tag that doesn't hold the plugin's actual bundle — a 404 on
    // install, invisible to any test that checks each side's literal in isolation.
    const stageDir = path.join(outRoot, "__tag_agreement__");
    const tags = stageReleaseAssets(FIRST_PARTY_PLUGIN_IDS, outRoot, stageDir);
    const fragment = buildCatalogFragment(FIRST_PARTY_PLUGIN_IDS, { resourcesDir: outRoot, appVersion: APP_VERSION });

    for (const entry of fragment) {
      const expectedTag = releaseTagFor(entry.id, entry.version);
      expect(entry.repo.endsWith(`/${expectedTag}`)).toBe(true);
      expect(tags).toContain(expectedTag);
    }
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

// Regression coverage for a real bug: the old guard compared the percent-encoded
// `import.meta.url` against the raw `process.argv[1]`, which breaks for any script
// path containing a space and never matches at all on Windows (`file:///C:/...`
// vs `C:\...`). A silent guard-miss means `main()` never runs: `node
// build-plugins.mjs` exits 0, builds nothing, and a Windows release ships with no
// seeded plugins — exactly the failure mode this file's ROOT-anchoring comment
// already warns about, just from a different cause.
describe("CLI entry-point guard", () => {
  test("isCliEntryPoint matches when the filename equals argv[1], including a path with a space", () => {
    const p = "/home/dev/dir with space/build-plugins.mjs";
    expect(isCliEntryPoint(p, p)).toBe(true);
  });

  test("isCliEntryPoint does not match when only imported (different entry script)", () => {
    expect(isCliEntryPoint("/repo/scripts/build-plugins.mjs", "/repo/node_modules/.bin/vitest")).toBe(false);
  });

  test("end-to-end: the guard fires for a real CLI invocation from a spaced path, without running main()", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "voltius-guard-"));
    const spacedDir = path.join(dir, "dir with space");
    mkdirSync(spacedDir, { recursive: true });
    const probePath = path.join(spacedDir, "probe.mjs");
    const modulePath = path.join(ROOT, "scripts/build-plugins.mjs");
    // Importing build-plugins.mjs here must NOT trigger main() (which would build
    // all six real plugins into src-tauri/resources/plugins/) — only probe.mjs
    // itself, as the actual CLI entry point, should evaluate as "true".
    writeFileSync(
      probePath,
      [
        `import { isCliEntryPoint } from ${JSON.stringify(modulePath)};`,
        `console.log(isCliEntryPoint(import.meta.filename, process.argv[1]));`,
      ].join("\n"),
    );
    const out = execFileSync("node", [probePath], { cwd: spacedDir }).toString().trim();
    expect(out).toBe("true");
    rmSync(dir, { recursive: true, force: true });
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

// A partial build used to rmSync the whole resources dir before building only its
// targets, so `node scripts/build-plugins.mjs docker` wiped the other five plugins —
// which breaks `cargo test --lib` (the embedding tests assert the six unconditionally)
// and fails a release build outright.
describe("pruneTargets", () => {
  const RES = "/res";

  test("a full build prunes the whole resources dir", () => {
    expect(pruneTargets(FIRST_PARTY_PLUGIN_IDS, RES)).toEqual([RES]);
  });

  test("a full build in a different order still prunes the whole dir", () => {
    expect(pruneTargets([...FIRST_PARTY_PLUGIN_IDS].reverse(), RES)).toEqual([RES]);
  });

  test("a single-plugin build prunes only that plugin, never the parent", () => {
    const targets = pruneTargets(["docker"], RES);
    expect(targets).toEqual([path.join(RES, "docker")]);
    expect(targets).not.toContain(RES);
  });

  test("a partial build prunes each of its targets and nothing else", () => {
    expect(pruneTargets(["docker", "proxmox"], RES)).toEqual([
      path.join(RES, "docker"),
      path.join(RES, "proxmox"),
    ]);
  });

  test("an unknown id does not make the build look full", () => {
    expect(pruneTargets(["not-a-plugin"], RES)).toEqual([path.join(RES, "not-a-plugin")]);
  });
});
