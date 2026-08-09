import { describe, it, expect, beforeEach } from "vitest";
import { useMcpContributionStore, isPluginExposed, setPluginExposed } from "./mcpContributionStore";

describe("the MCP contribution store", () => {
  beforeEach(() => useMcpContributionStore.setState({ exposed: {} }));

  it("defaults an unknown plugin to exposed", () => {
    expect(isPluginExposed("plugin-docker")).toBe(true);
  });

  it("remembers an explicit off", () => {
    setPluginExposed("plugin-docker", false);
    expect(isPluginExposed("plugin-docker")).toBe(false);
    setPluginExposed("plugin-docker", true);
    expect(isPluginExposed("plugin-docker")).toBe(true);
  });
});
