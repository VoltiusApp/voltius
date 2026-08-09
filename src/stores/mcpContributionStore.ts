import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Which installed plugins may expose their contributed tools to an external
 * MCP client. Per-device and never synced, like the MCP pairing grants: what
 * one machine exposes to a locally-connected agent is not a property of the
 * vault.
 *
 * Absent means exposed. A plugin the user consented to `mcp:contribute` for is
 * on by default; the row exists so it can be cut without uninstalling.
 */
interface McpContributionState {
  exposed: Record<string, boolean>;
  set: (pluginId: string, exposed: boolean) => void;
}

export const useMcpContributionStore = create<McpContributionState>()(
  persist(
    (set) => ({
      exposed: {},
      set: (pluginId, exposed) =>
        set((s) => ({ exposed: { ...s.exposed, [pluginId]: exposed } })),
    }),
    { name: "voltius-mcp-contributions" },
  ),
);

/** Non-reactive read, for the tool-list build. */
export function isPluginExposed(pluginId: string): boolean {
  return useMcpContributionStore.getState().exposed[pluginId] ?? true;
}

export function setPluginExposed(pluginId: string, exposed: boolean): void {
  useMcpContributionStore.getState().set(pluginId, exposed);
}
