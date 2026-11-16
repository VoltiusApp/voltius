import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { dashedCardClass } from "@/components/shared/dashedCard";
import { usePreviewStore } from "@/stores/previewStore";
import type { TeamObjectType } from "@/services/teamObjects";
import { usePreviewObject, useSubjectLabel } from "./PreviewScope";

interface GhostCardProps {
  layout: "grid" | "list";
  icon: string;
  name: string;
  onClick: () => void;
}

export function GhostCard({ layout, icon, name, onClick }: GhostCardProps) {
  const { t } = useTranslation();
  const subject = useSubjectLabel();
  const isList = layout === "list";
  return (
    <div
      role="button"
      tabIndex={0}
      data-ghost-card="true"
      className={`${dashedCardClass(layout)} border-(--t-border) opacity-[0.55] cursor-pointer`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
    >
      <AvatarTile
        icon={icon}
        iconSize={isList ? 14 : 24}
        size={isList ? 28 : 48}
        className="rounded-lg"
        iconClassName="text-(--t-text-dim)"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate text-(--t-text-dim)">{name}</p>
        <p className="text-xs truncate text-(--t-text-muted)">{t("members.viewAs.hiddenFrom", { name: subject })}</p>
      </div>
    </div>
  );
}

export interface GhostTarget {
  type: TeamObjectType;
  id: string;
  icon: string;
  name: string;
  layout: "grid" | "list";
}

export function GhostOr({ type, id, icon, name, layout, children }: GhostTarget & { children: ReactNode }) {
  const hidden = usePreviewObject(id)?.hidden === true;
  const showWhy = usePreviewStore((s) => s.showWhy);
  if (!hidden) return <>{children}</>;
  return <GhostCard layout={layout} icon={icon} name={name} onClick={() => showWhy(type, id)} />;
}

export function withGhost<P extends object>(Card: ComponentType<P>, target: (props: P) => GhostTarget): ComponentType<P> {
  return function Ghosted(props: P) {
    return (
      <GhostOr {...target(props)}>
        <Card {...props} />
      </GhostOr>
    );
  };
}
