import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { formatLocalShellTitle } from "@/utils/localShellTitle";
import { sessionLabel } from "@/utils/sessionLabel";
import { ConnectionAvatar } from "./ConnectionAvatar";
import { HostRow } from "./HostPickerPanel";
import { useSnippetTargetPicker } from "@/hooks/useSnippetTargetPicker";
import { connectionDisplayName } from "@/utils/connectionDisplayName";

interface Props {
  mode: "insert" | "execute";
  onConfirm: (sessionIds: string[]) => void;
  onClose: () => void;
}

export function SessionPickerPanel({ mode, onConfirm, onClose }: Props) {
  const { t } = useTranslation();
  const picker = useSnippetTargetPicker();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = mode === "insert" ? t("shared.sessionPicker.insertTitle") : t("shared.sessionPicker.executeTitle");
  const confirmLabel = mode === "insert"
    ? t("shared.sessionPicker.insertConfirm", { count: picker.totalSelected })
    : t("shared.sessionPicker.executeConfirm", { count: picker.totalSelected });

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-72 z-50 flex flex-col bg-(--t-bg-base) border-l border-(--t-bg-terminal) shadow-xl">
        <div className="flex items-center gap-2 px-3 py-3 shrink-0 bg-(--t-bg-card) border-b border-(--t-bg-terminal)">
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 text-(--t-text-dim)"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:x" width={14} />
          </button>
          <h2 className="text-sm font-semibold flex-1 text-(--t-text-primary)">{label}</h2>
        </div>

        <div className="px-2 py-2 shrink-0 bg-(--t-bg-toolbar) border-b border-(--t-bg-terminal)">
          <div className="relative">
            <Icon icon="lucide:search" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-(--t-text-dim)" />
            <input
              value={picker.search}
              onChange={(e) => picker.setSearch(e.target.value)}
              placeholder={t("common.placeholder.filter")}
              autoFocus
              className="form-input w-full pl-8 pr-2 h-8 rounded-lg text-xs outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 px-2">
          {picker.activeSessions.length === 0 && !picker.search && (
            <p className="px-3 py-3 text-xs text-(--t-text-muted)">{t("shared.sessionPicker.noActiveSessions")}</p>
          )}

          {picker.filteredSessions.length > 0 && (
            <>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-(--t-text-dim)">
                {t("shared.sessionPicker.activeSessionsHeader")}
              </p>
              {picker.filteredSessions.map((s) => (
                <HostRow
                  key={s.id}
                  avatar={
                    <div
                      className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem] transition-colors"
                      style={{
                        background: picker.selectedSessionIds.has(s.id) ? "var(--t-accent)" : "var(--t-bg-elevated)",
                        color: picker.selectedSessionIds.has(s.id) ? "#fff" : "var(--t-text-dim)",
                      }}
                    >
                      <Icon icon={picker.selectedSessionIds.has(s.id) ? "lucide:check" : "lucide:terminal"} width={13} />
                    </div>
                  }
                  name={sessionLabel(s)}
                  sub={s.type === "local" ? t("shared.pickers.thisComputer") : t("shared.sessionPicker.sshSessionSub")}
                  isSelected={picker.selectedSessionIds.has(s.id)}
                  onClick={() => picker.toggleSession(s.id)}
                />
              ))}
              <div className="mx-2 my-1.5 border-t border-(--t-bg-terminal)" />
            </>
          )}

          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-(--t-text-dim)">
            {t("shared.sessionPicker.openNewConnectionHeader")}
          </p>

          {/* Local shell rows */}
          {!picker.search && !picker.isAndroid && (picker.shells.length > 0 ? picker.shells : [{ name: t("shared.sessionPicker.localShellFallbackName"), path: "" }]).map((s) => {
            const selected = picker.localShell === s.path;
            return (
              <HostRow
                key={`local-${s.path}`}
                avatar={
                  <div
                    className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem] transition-colors"
                    style={{
                      background: selected ? "var(--t-accent)" : "var(--t-bg-elevated)",
                      color: selected ? "#fff" : "var(--t-text-dim)",
                    }}
                  >
                    <Icon icon={selected ? "lucide:check" : "lucide:monitor"} width={13} />
                  </div>
                }
                name={formatLocalShellTitle(s.path) || s.name}
                sub={t("shared.pickers.thisComputer")}
                isSelected={selected}
                onClick={() => picker.setLocalShell(selected ? null : s.path)}
              />
            );
          })}

          {!picker.search && picker.filteredHosts.length > 0 && (
            <div className="mx-2 my-1.5 border-t border-(--t-bg-terminal)" />
          )}

          {picker.filteredHosts.length === 0 && !picker.search && (
            <p className="px-3 py-4 text-xs text-center text-(--t-text-muted)">{t("shared.sessionPicker.noRemoteHostsFound")}</p>
          )}
          {picker.filteredHosts.length === 0 && picker.search && (
            <p className="px-3 py-4 text-xs text-center text-(--t-text-muted)">{t("shared.sessionPicker.noHostsFound")}</p>
          )}

          {picker.filteredHosts.map((c) => (
            <HostRow
              key={c.id}
              avatar={
                picker.selectedConnectionIds.has(c.id)
                  ? (
                    <div className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem]" style={{ background: "var(--t-accent)" }}>
                      <Icon icon="lucide:check" width={13} className="text-white" />
                    </div>
                  )
                  : <ConnectionAvatar connection={c} size={28} />
              }
              name={connectionDisplayName(c)}
              sub={`${c.username}@${c.host}:${c.port}`}
              isSelected={picker.selectedConnectionIds.has(c.id)}
              onClick={() => picker.toggleConnection(c.id)}
            />
          ))}
        </div>

        {picker.totalSelected > 0 && (
          <div className="shrink-0 px-3 py-3 border-t border-(--t-bg-terminal) bg-(--t-bg-card)">
            <button
              onClick={() => { void picker.confirm(onConfirm).then(() => onClose()); }}
              className="w-full h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-opacity"
              style={{ background: "var(--t-accent)", color: "#fff" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Icon icon={mode === "insert" ? "lucide:arrow-down-to-line" : "lucide:play"} width={14} />
              {confirmLabel}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
