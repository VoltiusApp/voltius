import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { JumpHost } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { HostPickerPanel, type HostChoice } from "@/components/shared/HostPickerPanel";
import { useListReorder } from "@/hooks/useListReorder";

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
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-3 shrink-0 border-b border-b-(--t-bg-terminal)">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-(--t-text-dim) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)"
          >
            <span className="[&_path]:stroke-3">
              <Icon icon="lucide:arrow-left" width={16} />
            </span>
          </button>
          <Icon icon="lucide:waypoints" width={14} className="text-(--t-text-dim)" />
          <h2 className="text-sm font-semibold flex-1 text-(--t-text-primary)">{t("connections.common.hostsChaining")}</h2>
        </div>

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
            const { isDragging, isOver, pos } = dnd.rowState(jh.id);
            return (
              <div
                key={jh.id}
                {...dnd.rowProps(jh.id)}
                style={{
                  opacity: isDragging ? 0.4 : 1,
                  cursor: dnd.dragging ? "grabbing" : undefined,
                  userSelect: "none",
                  ...(isOver && pos === "before" ? { borderTopColor: "var(--t-accent)" } : {}),
                  ...(isOver && pos === "after" ? { borderBottomColor: "var(--t-accent)" } : {}),
                }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-(--t-bg-elevated) border border-(--t-border) transition-colors"
              >
                {/* Drag handle */}
                <div
                  {...dnd.handleProps(jh.id)}
                  className="text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors shrink-0 cursor-grab active:cursor-grabbing"
                  aria-label={t("connections.jumpHostsPanel.dragToReorderAriaLabel")}
                >
                  <Icon icon="lucide:grip-vertical" width={14} />
                </div>

                <span className="w-5 h-5 rounded-full bg-(--t-accent) text-(--t-bg-card) text-[10px] font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>

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

                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => removeJumpHost(jh.id)}
                  className="text-(--t-text-dim) hover:text-red-400 transition-colors shrink-0"
                  aria-label={t("connections.jumpHostsPanel.removeAriaLabel")}
                >
                  <Icon icon="lucide:x" width={14} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-(--t-border) text-xs text-(--t-text-dim) hover:text-(--t-text-primary) hover:border-(--t-border-hover) transition-colors"
          >
            <Icon icon="lucide:plus" width={13} />
            {t("connections.jumpHostsPanel.addButton")}
          </button>
        </div>
      </div>

      {/* Host picker slide-over */}
      <div
        className="absolute inset-0 transition-transform duration-200 ease-out"
        style={{ transform: showPicker ? "translateX(0)" : "translateX(100%)" }}
      >
        <HostPickerPanel
          onPick={handlePick}
          onBack={() => setShowPicker(false)}
        />
      </div>
    </div>
  );
}
