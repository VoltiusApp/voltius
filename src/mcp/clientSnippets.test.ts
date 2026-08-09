import { describe, it, expect } from "vitest";
import { buildMcpClientSnippet } from "./clientSnippets";

const WIN_PATH = "C:\\Users\\kikik\\voltius.exe";
const WIN_PATH_JSON_ESCAPED = "C:\\\\Users\\\\kikik\\\\voltius.exe";

describe("buildMcpClientSnippet", () => {
  it("claude-code shell-quotes, not JSON-escapes, a Windows path", () => {
    const snippet = buildMcpClientSnippet("claude-code", WIN_PATH);
    expect(snippet).toBe(`claude mcp add voltius -- "${WIN_PATH}" mcp`);
    expect(snippet).not.toContain(WIN_PATH_JSON_ESCAPED);
  });

  it("mcp-servers form uses the mcpServers key with command/args", () => {
    const snippet = buildMcpClientSnippet("mcp-servers", "/usr/bin/voltius");
    const parsed = JSON.parse(snippet);
    expect(parsed).toEqual({
      mcpServers: { voltius: { command: "/usr/bin/voltius", args: ["mcp"] } },
    });
  });

  it("mcp-servers form JSON-escapes a Windows path's backslashes", () => {
    const snippet = buildMcpClientSnippet("mcp-servers", WIN_PATH);
    expect(snippet).toContain(WIN_PATH_JSON_ESCAPED);
    expect(JSON.parse(snippet).mcpServers.voltius.command).toBe(WIN_PATH);
  });

  it("vscode form uses servers (not mcpServers) and an explicit stdio type", () => {
    const snippet = buildMcpClientSnippet("vscode", "/usr/bin/voltius");
    const parsed = JSON.parse(snippet);
    expect(parsed).toEqual({
      servers: { voltius: { type: "stdio", command: "/usr/bin/voltius", args: ["mcp"] } },
    });
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("vscode form JSON-escapes a Windows path", () => {
    const snippet = buildMcpClientSnippet("vscode", WIN_PATH);
    expect(snippet).toContain(WIN_PATH_JSON_ESCAPED);
    expect(JSON.parse(snippet).servers.voltius.command).toBe(WIN_PATH);
  });

  it("opencode form puts the exe and its args in a single command array", () => {
    const snippet = buildMcpClientSnippet("opencode", "/usr/bin/voltius");
    const parsed = JSON.parse(snippet);
    expect(parsed).toEqual({
      mcp: { voltius: { type: "local", command: ["/usr/bin/voltius", "mcp"], enabled: true } },
    });
    expect(Array.isArray(parsed.mcp.voltius.command)).toBe(true);
  });

  it("opencode form JSON-escapes a Windows path inside the command array", () => {
    const snippet = buildMcpClientSnippet("opencode", WIN_PATH);
    expect(snippet).toContain(WIN_PATH_JSON_ESCAPED);
    expect(JSON.parse(snippet).mcp.voltius.command[0]).toBe(WIN_PATH);
  });
});
