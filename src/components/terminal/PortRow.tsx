import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeClipboard } from "@/utils/clipboard";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { TunnelStatusDot } from "@/components/shared/TunnelStatusDot";

function formatBytes(b: number): string {
  if (b === 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export type BadgeType = "auto" | "adhoc" | null;

export function PortRow({
  label,
  portInfo,
  isActive,
  isError,
  isBusy,
  isDeleting,
  isSaving,
  badge,
  remoteListening,
  bytesTransferred,
  httpUrl,
  localPort,
  onToggle,
  onDelete,
  onSaveAsRule,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
  defaultName,
}: {
  label: string;
  portInfo: string;
  isActive: boolean;
  isError?: boolean;
  isBusy: boolean;
  isDeleting: boolean;
  isSaving?: boolean;
  badge: BadgeType;
  remoteListening?: boolean | null;
  bytesTransferred?: number;
  httpUrl?: string | null;
  localPort?: number;
  onToggle: () => void;
  onDelete: () => void;
  onSaveAsRule?: () => void;
  isRenaming?: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
  defaultName?: string;
}) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(1200);
  const [nameDraft, setNameDraft] = useState(defaultName ?? label);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCommittedRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      setNameDraft(defaultName ?? label);
      renameCommittedRef.current = false;
      // focus + select on entering rename mode
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming, defaultName, label]);

  const bytes = formatBytes(bytesTransferred ?? 0);

  async function copyAddress() {
    if (localPort == null) return;
    await writeClipboard(`localhost:${localPort}`);
    flash();
  }
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 group hover:bg-(--t-bg-elevated)">
      <TunnelStatusDot
        status={isError ? "error" : isActive ? "active" : "idle"}
        remoteListening={remoteListening}
      />

      {/* Label + port info */}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); renameCommittedRef.current = true; onRenameCommit?.(nameDraft.trim() || (defaultName ?? label)); }
                else if (e.key === "Escape") { e.preventDefault(); renameCommittedRef.current = true; onRenameCancel?.(); }
              }}
              onBlur={() => { if (renameCommittedRef.current) return; onRenameCommit?.(nameDraft.trim() || (defaultName ?? label)); }}
              spellCheck={false}
              className="text-xs font-medium bg-(--t-bg-elevated) text-(--t-text-primary)
                rounded px-1 -mx-1 outline-none min-w-0 flex-1 leading-tight"
            />
          ) : (
            <span className="text-xs font-medium text-(--t-text-primary) truncate leading-tight">
              {label}
            </span>
          )}
          {badge && (
            <span className={`text-[10px] px-1 py-0.5 rounded font-medium shrink-0 leading-none ${
              badge === "auto"
                ? "bg-purple-500/20 text-purple-400"
                : "bg-(--t-bg-elevated) text-(--t-text-muted)"
            }`}>
              {badge === "auto" ? t("terminal.ports.badge.auto") : t("terminal.ports.badge.adHoc")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-(--t-text-muted) truncate leading-tight">
            {portInfo}
          </span>
          {bytes && (
            <span className="text-[10px] text-(--t-text-dim) shrink-0 leading-tight">
              {bytes}
            </span>
          )}
        </div>
      </div>

      {/* Toggle pause/resume — hover only */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        disabled={isBusy}
        title={isActive ? t("terminal.ports.pauseForwarding") : t("terminal.ports.resumeForwarding")}
        className={`w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
          opacity-0 group-hover:opacity-100
          ${isActive
            ? "text-(--t-text-muted) hover:text-amber-400 hover:bg-amber-500/10"
            : "text-(--t-text-muted) hover:text-green-400 hover:bg-green-500/10"
          }`}
      >
        {isBusy ? (
          <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
        ) : isActive ? (
          <Icon icon="lucide:pause" width={11} />
        ) : (
          <Icon icon="lucide:play" width={11} />
        )}
      </button>

      {/* Delete — hover only */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        disabled={isDeleting}
        title={t("common.action.delete")}
        className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
          opacity-0 group-hover:opacity-100
          text-(--t-text-muted) hover:text-red-400 hover:bg-red-500/10"
      >
        {isDeleting ? (
          <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
        ) : (
          <Icon icon="lucide:trash-2" width={11} />
        )}
      </button>

      {/* Save as rule — ad-hoc/auto rows only */}
      {onSaveAsRule && (
        <button
          onClick={(e) => { e.stopPropagation(); onSaveAsRule(); }}
          disabled={isSaving}
          title={t("terminal.ports.saveAsRule")}
          className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
            opacity-0 group-hover:opacity-100
            text-(--t-text-muted) hover:text-(--t-accent) hover:bg-(--t-bg-elevated)"
        >
          {isSaving ? (
            <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
          ) : (
            <Icon icon="lucide:bookmark-plus" width={11} />
          )}
        </button>
      )}

      {/* Copy localhost:port — visible on active rows */}
      {isActive && localPort != null && (
        <button
          onClick={(e) => { e.stopPropagation(); void copyAddress(); }}
          title={t("terminal.ports.copyAddress", { port: localPort })}
          className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
            text-(--t-text-muted) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)"
        >
          <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={11}
            className={copied ? "text-green-400" : ""} />
        </button>
      )}

      {/* Open in browser — always visible, rightmost */}
      {isActive && httpUrl && (
        <button
          onClick={(e) => { e.stopPropagation(); void openUrl(httpUrl); }}
          title={t("terminal.ports.openUrl", { url: httpUrl })}
          className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
            text-(--t-text-muted) hover:text-blue-400 hover:bg-blue-500/10"
        >
          <Icon icon="lucide:globe" width={11} />
        </button>
      )}
    </div>
  );
}
