import { useTranslation } from "react-i18next";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { BaseCard } from "@/components/shared/BaseCard";
import { fingerprintLabel, isTlsPin } from "@/services/knownHosts";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import type { KnownHost, VaultOption } from "@/types";
import { CardActionButton, CardMenuButton } from "@/components/shared/CardActionButton";

interface KnownHostCardProps {
  host: KnownHost;
  isSelected?: boolean;
  isFocused?: boolean;
  isList?: boolean;
  canEdit?: boolean;
  otherVaults?: VaultOption[];
  onSelect?: (e: React.MouseEvent) => void;
  onDelete?: () => void;
  onMoveVault?: (vaultId: string) => void;
  onCopyVault?: (vaultId: string) => void;
}

function truncateFingerprint(fp: string): string {
  // SHA256:xxxx... → keep prefix + first 16 chars of hash
  const colonIdx = fp.indexOf(":");
  if (colonIdx !== -1) {
    const algo = fp.slice(0, colonIdx + 1);
    const hash = fp.slice(colonIdx + 1);
    return algo + (hash.length > 16 ? hash.slice(0, 16) + "…" : hash);
  }
  return fp.length > 22 ? fp.slice(0, 22) + "…" : fp;
}

export function KnownHostCard({
  host,
  isSelected,
  isFocused,
  isList,
  canEdit,
  otherVaults,
  onSelect,
  onDelete,
  onMoveVault,
  onCopyVault,
}: KnownHostCardProps) {
  const { t } = useTranslation();
  const tlsBadge = isTlsPin(host.fingerprint) && (
    <span className="ml-1.5 px-1 py-px rounded text-[10px] font-semibold bg-(--t-bg-elevated) text-(--t-text-dim)" data-tls-badge>
      {t("knownHosts.tlsBadge")}
    </span>
  );
  const fingerprint = fingerprintLabel(host.fingerprint, t, truncateFingerprint);
  const address = `${host.host}:${host.port}`;
  const title = host.name ?? address;
  const contextMenuItems = [
    ...vaultMenuItems(otherVaults, canEdit, onMoveVault, onCopyVault, t),
    ...(canEdit && onDelete
      ? [{ label: t("common.action.delete"), icon: "lucide:trash-2", danger: true, divider: true, onClick: onDelete, shortcut: getShortcutHint("delete") }]
      : []),
  ];

  const bulkContextMenuItems = [
    ...(canEdit && onDelete
      ? [{ label: t("common.action.delete"), icon: "lucide:trash-2", danger: true, onClick: onDelete, shortcut: getShortcutHint("delete") }]
      : []),
  ];

  return (
    <BaseCard
      isSelected={isSelected}
      isFocused={isFocused}
      isList={isList}
      glass={!isList}
      onClick={onSelect}
      contextMenuItems={contextMenuItems}
      bulkContextMenuItems={bulkContextMenuItems}
      data-selectable-id={host.id}
    >
      <AvatarTile icon="lucide:fingerprint-pattern" iconSize={isList ? 14 : 18} className={`rounded-xl ${isList ? "w-7 h-7" : "w-10 h-10"}`} />

      <div className="min-w-0 flex-1">
        {isList ? (
          <div className="flex items-center gap-4">
            <p className="text-sm font-medium text-(--t-text-primary) truncate w-52 shrink-0">
              {title}
              {tlsBadge}
            </p>
            <p className="text-xs text-(--t-text-dim) truncate flex-1 min-w-0">{host.name && address}</p>
            <p className="text-xs text-(--t-text-dim) font-mono shrink-0 hidden md:block">{fingerprint}</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-(--t-text-primary) truncate">
              {title}
              {tlsBadge}
            </p>
            {host.name && <p className="text-xs text-(--t-text-dim) truncate mt-0.5">{address}</p>}
            <p className="text-xs text-(--t-text-dim) font-mono truncate mt-1">
              {fingerprint}
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {isList && canEdit && onDelete && <CardActionButton icon="lucide:trash-2" title={t("common.action.delete")} danger width={14} onClick={onDelete} />}
        <CardMenuButton width={14} />
      </div>
    </BaseCard>
  );
}
