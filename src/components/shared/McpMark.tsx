import { Icon } from "@iconify/react";
import type { TFunction } from "i18next";
import type { McpOwner } from "@/stores/mcpOwnershipStore";

/** The tooltip for an MCP-owned surface. Each site passes its own key set:
 *  a tab is "opened by", a transfer is "started by". A `null` clientId means
 *  the owning client disconnected, leaving the surface an orphan. */
export function mcpOwnerTitle(
  owner: McpOwner | undefined,
  t: TFunction,
  keys: { known: string; unknown: string; disconnected: string },
): string | undefined {
  if (!owner) return undefined;
  if (!owner.clientName) return t(keys.unknown);
  return t(owner.clientId === null ? keys.disconnected : keys.known, { client: owner.clientName });
}

/** Background for a surface an MCP client owns. */
export function mcpTint(base: string): string {
  return `color-mix(in srgb, var(--t-mcp) 10%, ${base})`;
}

type Props =
  | { variant: "rail"; testId: string; busy: boolean; disconnected?: boolean }
  | { variant: "chip"; title: string | undefined; label: string; disconnected?: boolean };

export function McpMark(props: Props) {
  if (props.variant === "rail") {
    return (
      <span
        data-testid={props.testId}
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${props.busy && !props.disconnected ? "mcp-pulse" : ""}`}
        style={{ background: "var(--t-mcp)", opacity: props.disconnected ? 0.4 : 1 }}
      />
    );
  }
  return (
    <span
      data-testid="mcp-chip"
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold"
      style={{
        background: `color-mix(in srgb, var(--t-mcp) ${props.disconnected ? 10 : 22}%, transparent)`,
        color: "var(--t-mcp)",
        opacity: props.disconnected ? 0.6 : 1,
      }}
      title={props.title}
    >
      <Icon icon="lucide:bot" width={11} />
      {props.label}
    </span>
  );
}
