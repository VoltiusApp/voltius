import { describe, it, expect } from "vitest";
import { buildMcpRegisterCommand } from "./registerCommand";

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
