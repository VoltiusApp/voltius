import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { JumpHost } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { HostPickerPanel, type HostChoice } from "@/components/shared/HostPickerPanel";
import { useListReorder } from "@/hooks/useListReorder";
import { ReorderableRow } from "@/components/shared/reorder";
import { SlideOverHeader, DashedAddButton, SlideOver } from "@/components/shared/slideOver";

interface Props {
  jumpHosts: JumpHost[];
  onChange: (updated: JumpHost[]) => void;
  onBack: () => void;
}

export default function JumpHostsPanel({ jumpHosts, onChange, onBack }: Props) {
  const { t } = useTranslation();
  const { connections } = useConnectionStore();
  const [showPicker, setShowPicker] = useState(false);
  const dnd = useListReorder(jumpHosts, onChange);

  const handlePick = (choice: HostChoice) => {
    if (choice.kind !== "remote") return;
    const conn = choice.connection;
    if (jumpHosts.some((j) => j.connection_id === conn.id)) {
      setShowPicker(false);
      return;
    }
    // Store only a live reference — host/port/username/creds are resolved from
    // the referenced connection at use time, so later edits to it take effect.
    onChange([...jumpHosts, {
      id: crypto.randomUUID(),
      connection_id: conn.id,
    }]);
    setShowPicker(false);
  };

  const removeJumpHost = (id: string) => {
    onChange(jumpHosts.filter((j) => j.id !== id));
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-(--t-bg-card)">
      <div className="flex flex-col h-full" {...dnd.containerProps}>
        <SlideOverHeader icon="lucide:waypoints" title={t("connections.common.hostsChaining")} onBack={onBack} />

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {jumpHosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <Icon icon="lucide:waypoints" width={32} className="text-(--t-text-dim) opacity-40" />
              <p className="text-xs text-(--t-text-dim)">{t("connections.jumpHostsPanel.emptyTitle")}</p>
              <p className="text-xs text-(--t-text-dim) opacity-70">
                {t("connections.jumpHostsPanel.emptySubtitle")}
              </p>
            </div>
          ) : (
            <p className="text-xs text-(--t-text-dim) pb-1">
              {t("connections.jumpHostsPanel.hint")}
            </p>
          )}

          {jumpHosts.map((jh, idx) => {
            const conn = connections.find((c) => c.id === jh.connection_id);
            // Prefer live values from the referenced connection; fall back to
            // the snapshot for deleted/imported jump hosts.
            const host = conn?.host ?? jh.host ?? "?";
            const port = conn?.port ?? jh.port ?? 22;
            const username = conn?.username ?? jh.username ?? "?";
            return (
              <ReorderableRow
                key={jh.id}
                dnd={dnd}
                id={jh.id}
                index={idx}
                onRemove={() => removeJumpHost(jh.id)}
                removeLabel={t("connections.jumpHostsPanel.removeAriaLabel")}
                dragLabel={t("connections.jumpHostsPanel.dragToReorderAriaLabel")}
              >
                {conn ? (
                  <ConnectionAvatar connection={conn} size={24} />
                ) : (
                  <div className="w-6 h-6 rounded-sm flex items-center justify-center bg-(--t-bg-base) text-(--t-text-dim) shrink-0">
                    <Icon icon="lucide:server" width={12} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-(--t-text-primary) truncate">
                    {conn?.name ?? `${username}@${host}`}
                  </p>
                  <p className="text-xs text-(--t-text-dim) truncate">
                    {username}@{host}:{port}
                  </p>
                </div>
              </ReorderableRow>
            );
          })}

          <DashedAddButton onClick={() => setShowPicker(true)}>{t("connections.jumpHostsPanel.addButton")}</DashedAddButton>
        </div>
      </div>

      <SlideOver open={showPicker}>
        <HostPickerPanel
          onPick={handlePick}
          onBack={() => setShowPicker(false)}
        />
      </SlideOver>
    </div>
  );
}
