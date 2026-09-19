import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { PickerDivider, PickerFooterAction } from "@/components/shared/pickerParts";
import { HostSessionRows } from "@/components/layout/HostSessionRows";
import { canDuplicateSession, duplicateSession } from "@/services/duplicateSession";
import { useUIStore } from "@/stores/uiStore";
import type { TerminalSession } from "@/types";

export function HostStackMenu({ members, shownId, activeSessionId, anchorRef, open, onClose, hoverBind }: {
  members: TerminalSession[];
  shownId: string;
  activeSessionId: string | null;
  anchorRef: { readonly current: HTMLElement | null };
  open: boolean;
  onClose: () => void;
  hoverBind: { onMouseEnter(): void; onMouseLeave(): void };
}) {
  const { t } = useTranslation();
  const shown = members.find((member) => member.id === shownId) ?? members[0];
  const host = shown.connectionName;
  return (
    <PickerSurface open={open} onClose={onClose} anchorRef={anchorRef} width="content" minWidth="16rem" gap={0} glass>
      <div {...hoverBind} className="py-1.5">
        <div className="flex items-center justify-between pl-3 pr-1.5">
          <p className="pt-1 pb-1 text-[11px] font-bold uppercase tracking-widest text-(--t-text-dim)">
            {t("layout.titleBar.stack.sessions", { host, count: members.length })}
          </p>
          <button
            type="button"
            title={t("layout.titleBar.stack.pin")}
            onClick={() => { useUIStore.getState().setHostPanelPinned(true); onClose(); }}
            className="size-7 flex items-center justify-center rounded-lg text-(--t-text-muted) hover:bg-(--t-bg-card-hover) hover:text-(--t-text-primary)"
          >
            <Icon icon="lucide:pin" width={14} />
          </button>
        </div>
        <HostSessionRows
          rows={members.map((session) => ({ session, splitTabId: null }))}
          members={members}
          shownId={shownId}
          activeSessionId={activeSessionId}
          variant="compact"
          onActivate={onClose}
        />
        {canDuplicateSession(shown) && (
          <>
            <PickerDivider />
            <PickerFooterAction
              icon="lucide:plus"
              label={t("layout.titleBar.stack.newSessionOn", { host })}
              onClick={() => { duplicateSession(shown.id, "tab"); onClose(); }}
            />
          </>
        )}
      </div>
    </PickerSurface>
  );
}
