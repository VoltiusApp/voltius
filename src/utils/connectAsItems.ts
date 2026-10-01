import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { PickTarget } from "@/services/credentialPlan";

export type ConnectAsCurrent = { kind: "pick"; id: string } | { kind: "host" } | { kind: "none" };

export function buildConnectAsItems({
  choices,
  current,
  ownIds,
  hostLabel,
  hasPick,
  vaultName,
  t,
  onPick,
  onOpenVaultDefault,
}: {
  choices: PickTarget[];
  current: ConnectAsCurrent;
  ownIds: Set<string>;
  hostLabel: string | null;
  hasPick: boolean;
  vaultName: string;
  t: TFunction;
  onPick: (identityId: string | null) => void;
  onOpenVaultDefault: () => void;
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = choices.map((c) => ({
    label: c.name ?? c.username,
    icon: current.kind === "pick" && c.id === current.id ? "lucide:check" : ownIds.has(c.id) ? "lucide:user-round" : "lucide:key-round",
    hint: ownIds.has(c.id) ? t("hosts.connectAs.yours") : undefined,
    onClick: () => onPick(c.id),
  }));
  if (hostLabel) {
    items.push({
      label: hostLabel,
      icon: current.kind === "host" ? "lucide:check" : "lucide:server",
      hint: t("hosts.connectAs.hostDefault"),
      onClick: () => onPick(null),
    });
  } else if (hasPick) {
    items.push({ label: t("hosts.connectAs.clearPick"), icon: "lucide:eraser", onClick: () => onPick(null) });
  }
  items.push({ label: t("hosts.connectAs.vaultDefault", { vault: vaultName }), icon: "lucide:user-round-cog", divider: true, onClick: onOpenVaultDefault });
  return items;
}
