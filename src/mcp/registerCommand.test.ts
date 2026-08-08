import { describe, it, expect } from "vitest";
import { buildMcpRegisterCommand, buildAddMcpCommand } from "./registerCommand";

describe("buildMcpRegisterCommand", () => {
  it("double-quotes a spaced Windows path", () => {
    expect(buildMcpRegisterCommand("C:\\Program Files\\Voltius\\voltius.exe")).toBe(
      'claude mcp add voltius -- "C:\\Program Files\\Voltius\\voltius.exe" mcp',
    );
  });

  it("single-quotes a spaced unix path", () => {
    expect(buildMcpRegisterCommand("/Applications/My Voltius.app/Contents/MacOS/voltius")).toBe(
      "claude mcp add voltius -- '/Applications/My Voltius.app/Contents/MacOS/voltius' mcp",
    );
  });

  it("escapes an embedded single quote on unix", () => {
    expect(buildMcpRegisterCommand("/home/o'brien/voltius")).toBe(
      "claude mcp add voltius -- '/home/o'\\''brien/voltius' mcp",
    );
  });

  it("keeps the -- separator and trailing mcp subcommand", () => {
    const cmd = buildMcpRegisterCommand("/usr/bin/voltius");
    expect(cmd.startsWith("claude mcp add voltius -- ")).toBe(true);
    expect(cmd.endsWith(" mcp")).toBe(true);
  });
});

describe("buildAddMcpCommand", () => {
  it("matches the verified add-mcp v2 invocation exactly", () => {
    expect(buildAddMcpCommand("/usr/bin/voltius")).toBe(
      "npx add-mcp@2 '/usr/bin/voltius' --args mcp -n voltius -g",
    );
  });

  it("pins the major version — a future add-mcp release must not silently change behaviour", () => {
    expect(buildAddMcpCommand("/usr/bin/voltius")).toContain("add-mcp@2");
  });

  it("passes the global flag — Voltius is not project-scoped and add-mcp defaults to per-project", () => {
    expect(buildAddMcpCommand("/usr/bin/voltius")).toMatch(/(^|\s)-g(\s|$)/);
  });

  it("never passes -y — the confirmation prompt is deliberate on a host holding SSH credentials", () => {
    expect(buildAddMcpCommand("/usr/bin/voltius")).not.toMatch(/(^|\s)-y(\s|$)/);
  });

  it("keeps mcp as a separate --args token, not concatenated into the path", () => {
    expect(buildAddMcpCommand("/usr/bin/voltius")).toContain("--args mcp");
  });

  it("shell-quotes a spaced unix path so it survives as one argv token", () => {
    expect(buildAddMcpCommand("/Applications/My Voltius.app/Contents/MacOS/voltius")).toBe(
      "npx add-mcp@2 '/Applications/My Voltius.app/Contents/MacOS/voltius' --args mcp -n voltius -g",
    );
  });

  it("shell-quotes a spaced Windows path", () => {
    expect(buildAddMcpCommand("C:\\Program Files\\Voltius\\voltius.exe")).toBe(
      'npx add-mcp@2 "C:\\Program Files\\Voltius\\voltius.exe" --args mcp -n voltius -g',
    );
  });
});
