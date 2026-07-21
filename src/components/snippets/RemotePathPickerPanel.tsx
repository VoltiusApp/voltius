import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { HostPickerPanel, type HostChoice } from "@/components/shared/HostPickerPanel";
import { useSftpDir, breadcrumbs } from "@/services/useSftpDir";
import type { Connection } from "@/types";

interface Props {
  isDir: boolean;
  onPick: (path: string) => void;
  onBack: () => void;
}

/** Slide-over remote path picker: stage 1 picks a host (reusing HostPickerPanel),
 *  stage 2 browses its SFTP tree. Mirrors KeyExportPanel's host slide-over. */
export function RemotePathPickerPanel({ isDir, onPick, onBack }: Props) {
  const [conn, setConn] = useState<Connection | undefined>(undefined);

  if (!conn) {
    return (
      <HostPickerPanel
        sshOnly
        onBack={onBack}
        onPick={(h: HostChoice) => { if (h.kind === "remote") setConn(h.connection); }}
      />
    );
  }
  return <RemoteTree connection={conn} isDir={isDir} onBack={() => setConn(undefined)} onPick={onPick} />;
}

function RemoteTree({
  connection, isDir, onBack, onPick,
}: { connection: Connection; isDir: boolean; onBack: () => void; onPick: (p: string) => void }) {
  const { t } = useTranslation();
  const { phase, cwd, entries, listing, navigate } = useSftpDir(connection);

  return (
    <div className="flex flex-col h-full bg-(--t-bg-base)">
      <div className="flex items-center gap-2 px-3 py-3 shrink-0 bg-(--t-bg-card) border-b border-b-(--t-bg-terminal)">
        <button
          onClick={onBack}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 text-(--t-text-dim) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)"
          aria-label={t("snippets.step.remotePicker.back")}
        >
          <span className="[&_path]:stroke-3"><Icon icon="lucide:arrow-left" width={16} /></span>
        </button>
        <h2 className="text-sm font-semibold flex-1 truncate text-(--t-text-primary)">
          {connection.name ?? connection.host}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {phase.tag === "connecting" && (
          <div className="text-xs" style={{ color: "var(--t-text-dim)" }}>{t("snippets.step.remotePicker.connecting")}</div>
        )}
        {phase.tag === "error" && (
          <div className="text-xs" style={{ color: "var(--t-danger)" }}>{phase.message}</div>
        )}
        {phase.tag !== "connecting" && phase.tag !== "error" && (
          <>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {breadcrumbs(cwd).map((b) => (
                <button key={b.path} type="button" onClick={() => navigate(b.path)} className="underline-offset-2 hover:underline text-(--t-text-secondary)">
                  {b.name}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-40 overflow-auto rounded-lg border" style={{ borderColor: "var(--t-border)" }}>
              {listing && <div className="p-2 text-xs" style={{ color: "var(--t-text-dim)" }}>…</div>}
              {entries.map((f) => (
                <div key={f.path} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-(--t-bg-hover)">
                  <Icon icon={f.isDir ? "lucide:folder" : "lucide:file"} width={14} className="text-(--t-text-dim) shrink-0" />
                  {f.isDir ? (
                    <button type="button" className="text-xs flex-1 text-left truncate text-(--t-text-primary)" onClick={() => navigate(f.path)}>{f.name}</button>
                  ) : (
                    <span className="text-xs flex-1 truncate text-(--t-text-primary)">{f.name}</span>
                  )}
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 rounded-md border shrink-0 disabled:opacity-40"
                    style={{ borderColor: "var(--t-border)" }}
                    onClick={() => onPick(f.path)}
                    disabled={isDir !== f.isDir}
                  >
                    {t("snippets.step.remotePicker.select")}
                  </button>
                </div>
              ))}
            </div>
            {isDir && (
              <button
                type="button"
                className="text-xs px-3 py-2 rounded-lg border self-start bg-(--t-bg-elevated)"
                style={{ borderColor: "var(--t-border)" }}
                onClick={() => onPick(cwd)}
              >
                {t("snippets.step.remotePicker.selectFolder")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
