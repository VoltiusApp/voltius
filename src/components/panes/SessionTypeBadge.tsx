import { useTranslation } from "react-i18next";
import type { TerminalSession } from "@/types";

const BADGE_KEY = {
  ssh: "panes.badge.ssh",
  serial: "panes.badge.serial",
  multiplayer: "panes.badge.multiplayer",
  local: "panes.badge.local",
  web: "panes.badge.web",
} as const;

export function SessionTypeBadge({ type }: { type: TerminalSession["type"] }) {
  const { t } = useTranslation();
  return (
    // leading-none: the inherited text-xs line-height is absolute and would overflow an h-7 row.
    <span className="px-1.5 py-0.5 rounded-sm border border-(--t-border) bg-(--t-bg-elevated) text-[10px] leading-none font-semibold">
      {t(BADGE_KEY[type])}
    </span>
  );
}
