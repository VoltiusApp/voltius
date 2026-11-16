import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { dashedCardClass, type CardLayout } from "@/components/shared/dashedCard";
import { usePreviewStore } from "@/stores/previewStore";
import type { TeamObjectType } from "@/services/teamObjects";
import { usePreviewObject, useSubjectLabel } from "./PreviewScope";

interface GhostCardProps {
  layout: CardLayout;
  icon: string;
  name: string;
  noKey?: boolean;
  onClick: () => void;
}

export function GhostCard({ layout, icon, name, noKey = false, onClick }: GhostCardProps) {
  const { t } = useTranslation();
  const subject = useSubjectLabel();
  const [tile, glyph] = { grid: [48, 24], list: [28, 14], row: [40, 20] }[layout];
  const card = (
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
        iconSize={glyph}
        size={tile}
        className="rounded-lg"
        iconClassName="text-(--t-text-dim)"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate text-(--t-text-dim)">{name}</p>
        <p className="text-xs truncate text-(--t-text-muted)">{t(noKey ? "members.viewAs.hiddenNoKey" : "members.viewAs.hiddenFrom", { name: subject })}</p>
      </div>
    </div>
  );
  return layout === "row" ? <div className="h-[72px] px-2 py-1">{card}</div> : card;
}

export interface GhostTarget {
  type: TeamObjectType;
  id: string;
  icon: string;
  name: string;
  layout: CardLayout;
}

export function GhostOr({ type, id, icon, name, layout, children }: GhostTarget & { children: ReactNode }) {
  const object = usePreviewObject(id);
  const showWhy = usePreviewStore((s) => s.showWhy);
  if (!object?.hidden) return <>{children}</>;
  return <GhostCard layout={layout} icon={icon} name={name} noKey={object.noKey} onClick={() => showWhy(type, id)} />;
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
