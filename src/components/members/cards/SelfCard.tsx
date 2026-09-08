import { useTranslation } from "react-i18next";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { BaseCard } from "@/components/shared/BaseCard";
import type { LayoutMode } from "@/components/shared/ToolbarViewControls";

/**
 * The "you" row on a private vault that has no team yet — the only member there
 * is, and always its owner. `handle` is null while it is still loading, "" when
 * the keychain has no handle to give.
 */
export function SelfCard({ handle, layoutMode }: { handle: string | null; layoutMode: LayoutMode }) {
  const { t } = useTranslation();
  const isGrid = layoutMode === "grid";

  const name = handle === null
    ? <div
        className={`h-3.5 rounded-sm animate-pulse ${isGrid ? "w-20" : "w-40"}`}
        style={{ background: "var(--t-bg-elevated)" }}
      />
    : isGrid
      ? <p className="text-xs font-medium truncate text-(--t-text-bright) max-w-[120px]">{handle || t("members.you")}</p>
      : <p className="text-sm font-medium truncate text-(--t-text-bright)">{handle || t("members.you")}</p>;

  // Spelled out per branch rather than interpolated: a template that appended
  // "px-1" after "px-1.5" left both classes on the element, and Tailwind
  // resolves that by stylesheet order, not string order — the grid badge
  // silently took the wrong padding.
  const youBadge = (
    <span
      className={isGrid
        ? "text-[9px] px-1 py-0.5 rounded-sm shrink-0"
        : "text-[10px] px-1.5 py-0.5 rounded-sm shrink-0"}
      style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}
    >
      {t("members.youBadge")}
    </span>
  );

  const ownerChip = (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{ color: "#a78bfa", background: "rgba(167,139,250,0.12)" }}
    >
      {t("members.ownerRoleLabel")}
    </span>
  );

  if (isGrid) {
    return (
      <BaseCard isList={false} className="flex-col items-center text-center gap-2 py-4">
        <MiniAvatar name={handle || "?"} size={40} />
        <div className="w-full min-w-0 flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 justify-center">
            {name}
            {youBadge}
          </div>
          {ownerChip}
        </div>
      </BaseCard>
    );
  }

  return (
    <BaseCard isList>
      <MiniAvatar name={handle || "?"} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {name}
          {youBadge}
        </div>
      </div>
      {ownerChip}
    </BaseCard>
  );
}
