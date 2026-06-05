import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { Modal } from "@/components/shared/Modal";
import { useUIStore } from "@/stores/uiStore";
import { reloadAll } from "@/services/import-export/registry";
import { useReloadFns } from "./useStores";
import { ExportTab } from "./ExportTab";
import { ImportTab } from "./ImportTab";
import { UserDataExportTab } from "./UserDataExportTab";
import { UserDataImportTab } from "./UserDataImportTab";

export function ImportExportModal() {
  const state = useUIStore(s => s.importExportModal);
  const close = useUIStore(s => s.closeImportExport);
  const reloaders = useReloadFns();

  const [activeSection, setActiveSection] = useState<"vaults" | "user-data">(state?.section ?? "vaults");
  const [activeMode, setActiveMode] = useState<"export" | "import">(state?.mode ?? "export");
  const lastNonce = useRef<number | undefined>(undefined);

  // Re-apply section/mode on every open invocation (identified by nonce), so
  // opening for a specific source while the modal is already open still works.
  useEffect(() => {
    if (state?.open && state.nonce !== lastNonce.current) {
      lastNonce.current = state.nonce;
      setActiveSection(state.section ?? "vaults");
      setActiveMode(state.mode ?? "export");
    }
  }, [state?.open, state?.nonce, state?.mode, state?.section]);

  useEffect(() => {
    if (state?.open && activeSection === "vaults") void reloadAll(reloaders);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.open, activeSection]);

  if (!state?.open) return null;

  const SECTIONS = [
    { id: "vaults" as const, label: "Vaults", icon: "lucide:vault" },
    { id: "user-data" as const, label: "User Data", icon: "lucide:user" },
  ];

  return (
    <Modal onClose={close} blur>
      <div
        className="flex flex-col animate-fadeIn overflow-hidden bg-[var(--t-bg-base)] border border-[var(--t-border)]"
        style={{ width: "min(680px, 94vw)", height: "min(580px, 90vh)", borderRadius: 14, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
      >
        <div className="grid grid-cols-3 items-center px-6 py-4 shrink-0 border-b border-b-[var(--t-border)]">
          <div className="flex items-center gap-3">
            <Icon icon="lucide:database" width={18} className="text-[var(--t-accent)]" />
            <span className="text-base font-semibold text-[var(--t-text-bright)]">Import / Export</span>
          </div>
          <div className="flex items-center justify-center gap-1">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: activeSection === s.id ? "var(--t-bg-input)" : "transparent",
                  color: activeSection === s.id ? "var(--t-text-bright)" : "var(--t-text-muted)",
                  border: `1px solid ${activeSection === s.id ? "var(--t-border-hover)" : "transparent"}`,
                }}
              >
                <Icon icon={s.icon} width={13} />
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={close}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-[var(--t-text-muted)]"
              onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}
            >
              <Icon icon="lucide:x" width={16} />
            </button>
          </div>
        </div>

        <div className="flex gap-1 px-6 pt-3 pb-0 shrink-0">
          {(["import", "export"] as const).map(mode => (
            <button key={mode} onClick={() => setActiveMode(mode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-sm font-medium transition-colors"
              style={{
                background: activeMode === mode ? "var(--t-bg-elevated)" : "transparent",
                color: activeMode === mode ? "var(--t-text-bright)" : "var(--t-text-muted)",
                borderBottom: activeMode === mode ? "2px solid var(--t-accent)" : "2px solid transparent",
              }}
            >
              <Icon icon={mode === "export" ? "lucide:upload" : "lucide:download"} width={13} />
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {activeSection === "vaults" ? (
            activeMode === "export" ? (
              <ExportTab
                selection={{ single: state.single, bulk: state.bulk }}
                preselectedTypes={state.preselectedTypes}
              />
            ) : (
              <ImportTab key={state.nonce} defaultSource={state.source} autoTrigger={state.autoTrigger} />
            )
          ) : (
            activeMode === "export" ? <UserDataExportTab /> : <UserDataImportTab onClose={close} />
          )}
        </div>
      </div>
    </Modal>
  );
}
