import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import BottomSheet from "@/components/mobile/sheets/BottomSheet";
import { useIsMobile } from "@/utils/platform";
import "./promos.css";

/** Desktop: a centered solid modal with a close button. Mobile: a BottomSheet, which
 *  brings its own drag/Back/scrim dismissal. Same switch as `PickerSurface`. */
export function PromoSurface({ onClose, children, width = "36rem" }: {
  onClose: () => void;
  children: ReactNode;
  /** CSS length of the desktop card, capped to the viewport. */
  width?: string;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  if (isMobile) return <BottomSheet onClose={onClose}>{children}</BottomSheet>;

  return (
    <Modal onClose={onClose}>
      <ModalCard
        solid
        className="relative overflow-x-hidden overflow-y-auto animate-fadeIn"
        style={{ width: `min(${width}, 92vw)`, maxHeight: "92vh" }}
      >
        {children}
        <button
          type="button"
          aria-label={t("shared.promos.close")}
          onClick={onClose}
          className="absolute top-2 right-2 w-11 h-11 rounded-[var(--r-md)] flex items-center justify-center text-(--t-text-muted) hover:text-(--t-text-primary) hover:bg-(--t-bg-card-hover) transition-colors focus-ring"
        >
          <Icon icon="lucide:x" width={16} />
        </button>
      </ModalCard>
    </Modal>
  );
}

/** One primary CTA, the reassurance line under it, then the low-emphasis exits. */
export function PromoFooter({ cta, onCta, busy = false, note, secondary, onSecondary, link }: {
  cta: string;
  onCta: () => void;
  busy?: boolean;
  note?: string;
  secondary?: string;
  onSecondary?: () => void;
  link?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onCta}
        disabled={busy}
        aria-busy={busy}
        className="btn btn-primary min-h-11 px-4 rounded-[var(--r-md)] text-[15px] font-semibold flex items-center justify-center gap-2"
      >
        {busy && <Icon icon="lucide:loader-circle" width={16} className="animate-spin" />}
        {cta}
      </button>
      {note && <p className="mt-2.5 text-xs text-center text-(--t-text-muted)">{note}</p>}
      {(secondary || link) && (
        <div className={`mt-1.5 flex gap-3 ${link && secondary ? "justify-between" : "justify-center"}`}>
          {secondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="min-h-11 px-1 text-[13px] font-medium text-(--t-text-secondary) hover:text-(--t-text-primary) transition-colors focus-ring rounded-[var(--r-sm)]"
            >
              {secondary}
            </button>
          )}
          {link && (
            <button
              type="button"
              onClick={link.onClick}
              className="min-h-11 px-1 text-[13px] font-medium text-right text-(--t-accent) hover:text-(--t-accent-hover) transition-colors focus-ring rounded-[var(--r-sm)]"
            >
              {link.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PromoTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 pr-8 text-2xl leading-tight font-bold tracking-[-0.01em] text-(--t-text-bright)">
      {children}
    </h2>
  );
}

export function PromoBody({ children }: { children: ReactNode }) {
  return <p className="mt-2.5 text-sm leading-relaxed text-(--t-text-secondary)">{children}</p>;
}
