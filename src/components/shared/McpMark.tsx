import { Icon } from "@iconify/react";
import type { TFunction } from "i18next";
import type { McpOwner } from "@/stores/mcpOwnershipStore";

/** The tooltip for an MCP-owned surface. Each site passes its own key pair:
 *  a tab is "opened by", a transfer is "started by". */
export function mcpOwnerTitle(
  owner: McpOwner | undefined,
  t: TFunction,
  keys: { known: string; unknown: string },
): string | undefined {
  if (!owner) return undefined;
  return owner.clientName ? t(keys.known, { client: owner.clientName }) : t(keys.unknown);
}

/** Background for a surface an MCP client owns. */
export function mcpTint(base: string): string {
  return `color-mix(in srgb, var(--t-mcp) 10%, ${base})`;
}

type Props =
  | { variant: "rail"; testId: string; busy: boolean }
  | { variant: "chip"; title: string | undefined; label: string };

export function McpMark(props: Props) {
  if (props.variant === "rail") {
    return (
      <span
        data-testid={props.testId}
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${props.busy ? "mcp-pulse" : ""}`}
        style={{ background: "var(--t-mcp)" }}
      />
    );
  }
  return (
    <span
      data-testid="mcp-chip"
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold"
      style={{ background: "color-mix(in srgb, var(--t-mcp) 22%, transparent)", color: "var(--t-mcp)" }}
      title={props.title}
    >
      <Icon icon="lucide:bot" width={11} />
      {props.label}
    </span>
  );
}
