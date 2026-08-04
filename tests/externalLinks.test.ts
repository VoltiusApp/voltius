import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// #74: Tauri's webview silently no-ops `<a target="_blank">` instead of handing the
// URL to the system browser. Outbound links must go through plugin-opener's openUrl.
const SRC = path.resolve(__dirname, "../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("external links", () => {
  it("never uses <a target=\"_blank\"> to open a URL", () => {
    const offenders = walk(SRC).filter((f) => /target=["']_blank["']/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("never uses an http(s) href attribute", () => {
    const offenders = walk(SRC).filter((f) => /href=["']https?:/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
