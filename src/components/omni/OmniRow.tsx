import type { ReactNode } from "react";
import { AvatarTile } from "@/components/shared/AvatarTile";

export interface RowNotice { text: string; tone: "danger" | "info" }

interface OmniRowProps {
  id: string;
  idx: number;
  selected: boolean;
  leading: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  detailMono?: boolean;
  trailing?: ReactNode;
  notice?: RowNotice | null;
  checked?: boolean;
  onPick: () => void;
  onHover: (idx: number) => void;
}

const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function OmniRow({
  id, idx, selected, leading, label, detail, detailMono, trailing, notice, checked, onPick, onHover,
}: OmniRowProps) {
  const tone = notice?.tone === "danger" ? "var(--t-status-error)" : "var(--t-accent)";
  return (
    <div
      role="option"
      id={id}
      aria-selected={selected}
      aria-checked={checked}
      data-idx={idx}
      onClick={onPick}
      onMouseMove={selected ? undefined : () => onHover(idx)}
      className="mx-1.5 flex items-center gap-3 px-2.5 py-2 rounded-[var(--r-sm)] cursor-pointer"
      style={selected ? { background: tint(tone, 14), boxShadow: `inset 0 0 0 1px ${tint(tone, 34)}` } : undefined}
    >
      {leading}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate ${selected ? "text-(--t-text-bright)" : "text-(--t-text-primary)"}`}>
          {label}
        </div>
        {notice ? (
          <p className="text-xs mt-0.5" style={{ color: notice.tone === "danger" ? "color-mix(in srgb, var(--t-status-error) 55%, var(--t-text-bright))" : "var(--t-text-secondary)" }}>
            {notice.text}
          </p>
        ) : detail ? (
          <p className={`text-xs mt-0.5 truncate text-(--t-text-dim) ${detailMono ? "font-mono" : ""}`}>{detail}</p>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}

export function OmniTile({ icon, accent = false }: { icon: string; accent?: boolean }) {
  return (
    <AvatarTile
      icon={icon}
      iconSize={13}
      className="w-7 h-7 rounded-lg shrink-0"
      iconClassName={accent ? "text-(--t-accent)" : "text-(--t-text-dim)"}
    />
  );
}
