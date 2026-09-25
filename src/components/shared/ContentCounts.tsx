import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import type { VaultObjectType } from "@/hooks/useVaultContents";

export function ContentCounts({
  counts,
  className,
  itemClassName = "flex items-center gap-1",
  itemStyle,
  iconWidth = 12,
}: {
  counts: VaultObjectType[];
  className?: string;
  itemClassName?: string;
  itemStyle?: CSSProperties;
  iconWidth?: number;
}) {
  const { t } = useTranslation();
  const nonZeroCounts = counts.filter((c) => c.count > 0);
  if (nonZeroCounts.length === 0) return null;

  const content = nonZeroCounts.map(({ key, icon, count }) => {
    const label = t(`common.contentCounts.${key}`, { count });
    return (
      <span key={key} className={itemClassName} style={itemStyle} title={label} aria-label={label}>
        <Icon icon={icon} width={iconWidth} style={{ color: "var(--t-text-dim)" }} />
        <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>{count}</span>
      </span>
    );
  });

  if (!className) return <>{content}</>;
  return <div className={className}>{content}</div>;
}
