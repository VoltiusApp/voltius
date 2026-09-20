import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { PickerDivider, PickerFooterAction } from "@/components/shared/pickerParts";
import { HostSessionRows, type HostSessionLabels } from "@/components/layout/HostSessionRows";
import { pinHostList } from "@/services/hostStack";
import { newSessionOnHostItem } from "@/utils/sessionMenuItems";
import { shownMember } from "@/utils/titlebarItems";
import type { TerminalSession } from "@/types";

export function HostStackMenu({ host, members, labels, shownId, activeSessionId, anchorRef, surfaceRef, open, onClose, hoverBind, onHoldChange }: {
  host: string;
  members: TerminalSession[];
  labels: HostSessionLabels;
  shownId: string;
  activeSessionId: string | null;
  anchorRef: { readonly current: HTMLElement | null };
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  onClose: () => void;
  hoverBind: { onMouseEnter(): void; onMouseLeave(): void };
  onHoldChange?: (hold: boolean) => void;
}) {
  const { t } = useTranslation();
  const shown = shownMember(members, shownId, undefined)!;
  const newSession = newSessionOnHostItem(t, shown, host);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <PickerSurface open={open} onClose={onClose} anchorRef={anchorRef} width="content" minWidth="16rem" gap={0} glass>
      <div ref={surfaceRef} {...hoverBind} data-testid="stack-menu-surface" className="-m-1.5 p-1.5">
        <div className="flex items-center justify-between pl-3 pr-1.5">
          <p className="pt-1 pb-1 text-[11px] font-bold uppercase tracking-widest text-(--t-text-dim)">
            {t("layout.titleBar.stack.sessions", { host, count: members.length })}
          </p>
          <button
            type="button"
            title={t("layout.titleBar.stack.pin")}
            onClick={() => { pinHostList(shown.id); onClose(); }}
            className="size-7 flex items-center justify-center rounded-lg text-(--t-text-muted) hover:bg-(--t-bg-card-hover) hover:text-(--t-text-primary)"
          >
            <Icon icon="lucide:pin" width={14} />
          </button>
        </div>
        <HostSessionRows
          rows={members.map((session) => ({ session, splitTabId: null }))}
          members={members}
          labels={labels}
          shownId={shownId}
          activeSessionId={activeSessionId}
          variant="compact"
          onActivate={onClose}
          onHoldChange={onHoldChange}
        />
        {newSession && (
          <>
            <PickerDivider />
            <PickerFooterAction
              icon={newSession.icon}
              label={newSession.label}
              onClick={() => { newSession.onClick(); onClose(); }}
            />
          </>
        )}
      </div>
    </PickerSurface>
  );
}
