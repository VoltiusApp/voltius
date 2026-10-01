import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { PickTarget } from "@/services/credentialPlan";

export function buildConnectAsItems({
  choices,
  currentPickId,
  ownIds,
  hostLabel,
  vaultName,
  t,
  onPick,
  onOpenVaultDefault,
}: {
  choices: PickTarget[];
  currentPickId: string | null;
  ownIds: Set<string>;
  hostLabel: string | null;
  vaultName: string;
  t: TFunction;
  onPick: (identityId: string | null) => void;
  onOpenVaultDefault: () => void;
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = choices.map((c) => ({
    label: c.name ?? c.username,
    icon: c.id === currentPickId ? "lucide:check" : ownIds.has(c.id) ? "lucide:user-round" : "lucide:key-round",
    hint: ownIds.has(c.id) ? t("hosts.connectAs.yours") : undefined,
    onClick: () => onPick(c.id),
  }));
  if (hostLabel) {
    items.push({
      label: hostLabel,
      icon: currentPickId ? "lucide:server" : "lucide:check",
      hint: t("hosts.connectAs.hostDefault"),
      onClick: () => onPick(null),
    });
  }
  items.push({ label: t("hosts.connectAs.vaultDefault", { vault: vaultName }), icon: "lucide:user-round-cog", divider: true, onClick: onOpenVaultDefault });
  return items;
}
