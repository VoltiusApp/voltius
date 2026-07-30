import { describe, test, expect, beforeEach, vi } from "vitest";

// The module memoizes its blob URLs in module scope, so each test needs a fresh
// copy — otherwise the idempotency guard from an earlier test suppresses injection
// here and the assertions measure the wrong thing.
async function freshModule() {
  vi.resetModules();
  return await import("./hostModules");
}

describe("hostModules", () => {
  beforeEach(() => {
    let n = 0;
    globalThis.URL.createObjectURL = vi.fn(
      () => `blob:host-${n++}`,
    ) as unknown as typeof URL.createObjectURL;
  });

  test("exposes a blob module for each of the five public specifiers", async () => {
    const { hostModuleUrls } = await freshModule();
    const urls = hostModuleUrls();
    expect(Object.keys(urls).sort()).toEqual([
      "@voltius/api",
      "@voltius/ui",
      "react",
      "react-dom",
      "react/jsx-runtime",
    ]);
    for (const url of Object.values(urls)) expect(url.startsWith("blob:")).toBe(true);
  });

  test("rewrites a bare react import to its blob URL", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`import React from "react";`);
    expect(out).toBe(`import React from "${hostModuleUrls()["react"]}";`);
  });

  test("rewrites react/jsx-runtime without the react rule clobbering it", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`import { jsx } from "react/jsx-runtime";`);
    expect(out).toContain(hostModuleUrls()["react/jsx-runtime"]);
    expect(out).not.toContain(`"${hostModuleUrls()["react"]}"`);
  });

  test("rewrites react-dom without the react rule clobbering it", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`import { flushSync } from "react-dom";`);
    expect(out).toContain(hostModuleUrls()["react-dom"]);
    expect(out).not.toContain(`"${hostModuleUrls()["react"]}"`);
  });

  test("rewrites dynamic imports, keeping them quoted", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`const m = await import("@voltius/ui");`);
    expect(out).toBe(`const m = await import("${hostModuleUrls()["@voltius/ui"]}");`);
  });

  test("rewrites export-from statements", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`export * from "@voltius/api";`);
    expect(out).toContain(hostModuleUrls()["@voltius/api"]);
  });

  test("rejects a bare specifier the host does not provide", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import uPlot from "uplot";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a remote URL specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import x from "https://evil.example/x.js";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a remote export-from specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `export * from "https://evil.example/x.js";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a dynamic import() with a non-literal specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `const x = await import(atob("aHR0cHM6Ly9ldmls"));`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/non-literal specifier/);
  });

  test("still allows a relative specifier left by the bundler", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import x from "./chunk.js";`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("does not rewrite a string that merely contains a host specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `const label = "react"; console.log(label);`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("does not rewrite import-like text inside a string literal", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `console.warn('do not import from "react" directly; use the plugin API');`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("rewrites the host specifier and leaves a relative specifier in a mixed bundle", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const src = [
      `import React from "react";`,
      `import util from "./util.js";`,
      `export const x = 1;`,
    ].join("\n");
    const out = await resolveHostSpecifiers(src);
    expect(out).toContain(`"${hostModuleUrls()["react"]}"`);
    expect(out).toContain(`import util from "./util.js";`);
  });
});
