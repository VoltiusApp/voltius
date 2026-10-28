import { describe, expect, it } from "vitest";
import { classHighlighter } from "@lezer/highlight";
import { detectScriptLanguage, highlightScript, SNIPPET_VAR_CLASS } from "./scriptLanguage";

describe("detectScriptLanguage", () => {
  it.each([
    "irm https://claude.ai/install.ps1 | iex",
    "$bin = Join-Path $env:USERPROFILE '.local\\bin'",
    "if (Test-Path $bin) { Write-Host ok }",
    "Get-Service | Where-Object Status -eq Running",
  ])("reads %s as PowerShell", (code) => {
    expect(detectScriptLanguage(code)).toBe("powershell");
  });

  it.each([
    "",
    "du -h --max-depth=1 \"{{path}}\" | sort -rh",
    "curl -H 'Content-Type: application/json' -d '{}' https://api",
    "export PATH=\"$HOME/.local/bin:$PATH\"",
    "#!/bin/bash\n# Write-Host is PowerShell, not this\necho hi",
  ])("reads %j as shell", (code) => {
    expect(detectScriptLanguage(code)).toBe("shell");
  });
});

describe("highlightScript", () => {
  const scripts = [
    "",
    "echo hi",
    "SERVICE=\"{{service}}\"\nif ! systemctl is-active --quiet \"$SERVICE\"; then\n  echo up\nfi",
    "# {{path}} in a comment\ndu -h {{path}}",
    "$env:Path = \"{{dir}};$env:Path\"",
    "{{a}}{{b}} {{unclosed",
  ];

  it.each(scripts)("reassembles %j exactly with no empty runs", (code) => {
    const segments = highlightScript(code, classHighlighter);
    expect(segments.map((s) => s.text).join("")).toBe(code);
    expect(segments.every((s) => s.text.length > 0)).toBe(true);
    segments.slice(1).forEach((s, i) => expect(s.cls).not.toBe(segments[i].cls));
  });

  it("marks whole {{vars}} over the token they sit in", () => {
    const segments = highlightScript("# see {{path}}\necho \"{{name:text}}\" {{x", classHighlighter);
    expect(segments.filter((s) => s.cls === SNIPPET_VAR_CLASS).map((s) => s.text)).toEqual(["{{path}}", "{{name:text}}"]);
  });

  it("styles shell keywords and strings", () => {
    const segments = highlightScript("if true; then echo \"hi\"; fi", classHighlighter);
    expect(segments.find((s) => s.text === "if")?.cls).toContain("tok-keyword");
    expect(segments.find((s) => s.text === "\"hi\"")?.cls).toContain("tok-string");
  });
});
