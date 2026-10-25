import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useUIStore } from "@/stores/uiStore";
import { useIsMobile } from "@/utils/platform";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { useOverlayTransition } from "@/hooks/pageTransition";
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
  const isMobile = useIsMobile();
  // Android: a full-screen page with a push / pop transition, previewed by predictive back.
  const overlay = useOverlayTransition(isMobile && !!state?.open);
  useBackInterceptor(isMobile && !!state?.open, close, () =>
    overlay.ref.current ? { el: overlay.ref.current, kind: "page", handoff: true } : null);

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

  if (!state?.open && !(isMobile && overlay.mounted)) return null;

  const body = (
    <ImportExportBody
      phone={isMobile}
      state={state}
      close={close}
      activeSection={activeSection}
      setActiveSection={setActiveSection}
      activeMode={activeMode}
      setActiveMode={setActiveMode}
    />
  );

  if (isMobile) {
    return createPortal(
      <div ref={overlay.ref} data-import-export-fullscreen data-vt-hit-scope className="fixed inset-0 z-50 flex flex-col surface-modal-solid"
        style={{ paddingTop: "var(--vt-safe-top)", paddingBottom: "var(--vt-safe-bottom)", paddingLeft: "var(--vt-safe-left)", paddingRight: "var(--vt-safe-right)" }}>
        {body}
      </div>,
      document.body,
    );
  }
  return (
    <Modal onClose={close} blur>
      <ModalCard solid className="flex flex-col animate-fadeIn overflow-hidden" style={{ width: "min(680px, 94vw)", height: "min(580px, 90vh)" }}>
        {body}
      </ModalCard>
    </Modal>
  );
}

type ImportExportState = NonNullable<ReturnType<typeof useUIStore.getState>["importExportModal"]>;

interface BodyProps {
  phone: boolean;
  state: ImportExportState;
  close: () => void;
  activeSection: "vaults" | "user-data";
  setActiveSection: (s: "vaults" | "user-data") => void;
  activeMode: "export" | "import";
  setActiveMode: (m: "export" | "import") => void;
}

function ImportExportBody({ phone, state, close, activeSection, setActiveSection, activeMode, setActiveMode }: BodyProps) {
  const { t } = useTranslation();
  const SECTIONS = [
    { id: "vaults" as const, label: t("common.entity.vaults"), icon: "lucide:vault" },
    { id: "user-data" as const, label: t("importExport.modal.sectionUserData"), icon: "lucide:user" },
  ];

  return (
    <>
      <div className={`grid items-center gap-3 shrink-0 ${phone ? "grid-cols-[1fr_auto] px-4 py-3" : "grid-cols-[auto_1fr_auto] px-6 py-4"} border-b border-b-(--t-border)`}>
        <div className="flex items-center gap-3">
          <Icon icon="lucide:database" width={18} className="text-(--t-accent)" />
          <span className="text-base font-semibold whitespace-nowrap text-(--t-text-bright)">{t("importExport.modal.title")}</span>
        </div>
        <div className={`flex items-center gap-1 ${phone ? "col-span-2 order-last justify-start" : "justify-center"}`}>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
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
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-(--t-text-muted)"
            onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}
          >
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>
      </div>

      <div className={`flex gap-1 ${phone ? "px-4" : "px-6"} pt-3 pb-0 shrink-0`}>
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
            {mode === "export" ? t("importExport.modal.tabExport") : t("importExport.modal.tabImport")}
          </button>
        ))}
      </div>

      <div className={`flex-1 overflow-y-auto ${phone ? "px-4" : "px-6"} py-5 min-h-0`}>
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
    </>
  );
}
