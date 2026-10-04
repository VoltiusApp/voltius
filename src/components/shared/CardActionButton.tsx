import { createContext, useContext } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

interface Props {
  icon: string;
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  /** When true (default) the button stays invisible until the card is hovered or focused; its space is always reserved. */
  reveal?: boolean;
  width?: number;
  iconClassName?: string;
}

const REVEAL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

export function CardActionButton({ icon, title, onClick, danger, reveal = true, width = 18, iconClassName }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`flex ${reveal ? REVEAL : ""} items-center justify-center p-1.5 rounded-lg transition-colors text-(--t-text-secondary)`}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger ? "var(--t-status-error)" : "var(--t-text-primary)";
        e.currentTarget.style.background = danger
          ? "color-mix(in srgb, var(--t-status-error) 18%, transparent)"
          : "color-mix(in srgb, #ffffff 10%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--t-text-secondary)";
        e.currentTarget.style.background = "transparent";
      }}
      title={title}
      aria-label={title}
    >
      <Icon icon={icon} width={width} className={iconClassName} />
    </button>
  );
}

/** Opens the card's own context menu; provided by the card that owns the menu. */
export const CardMenuContext = createContext<((e: React.MouseEvent<HTMLElement>) => void) | null>(null);

export function CardMenuButton({ width = 18 }: { width?: number }) {
  const { t } = useTranslation();
  const openMenu = useContext(CardMenuContext);
  if (!openMenu) return null;
  return (
    <CardActionButton
      icon="lucide:ellipsis"
      title={t("common.action.moreOptions")}
      reveal={false}
      width={width}
      onClick={openMenu}
    />
  );
}

export function CardPinButton({ color, title, onClick, width = 14 }: {
  color: string;
  title: string;
  onClick: () => void;
  width?: number;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="shrink-0 flex items-center transition-colors"
      style={{ color }}
      title={title}
      aria-label={title}
    >
      <Icon icon="lucide:pin" width={width} />
    </button>
  );
}
