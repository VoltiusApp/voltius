import TitleBar from "@/components/layout/TitleBar";
import VaultSidebar from "@/components/layout/VaultSidebar";
import VaultHeader from "@/components/layout/VaultHeader";
import NavBar from "@/components/layout/NavBar";
import MainPanel from "@/components/layout/MainPanel";
import { HostSessionsPanel } from "@/components/layout/HostSessionsPanel";
import OmniSearch from "@/components/omni/OmniSearch";
import GlobalPanelHost from "@/components/layout/GlobalPanelHost";
import RightPanel from "@/components/terminal/RightPanel";
import { EmailVerificationBanner } from "@/components/notifications/EmailVerificationBanner";
import { PreviewContentScope } from "@/components/preview/PreviewScope";
import { ViewAsBanner } from "@/components/preview/ViewAsBanner";
import { ViewAsPill } from "@/components/preview/ViewAsPill";
import { ViewAsSidePanel } from "@/components/preview/ViewAsSidePanel";
import { useUIStore } from "@/stores/uiStore";
import { usePreviewStore } from "@/stores/previewStore";

export default function DesktopShell() {
  const previewing = usePreviewStore((s) => s.session !== null);
  const omniOpen = useUIStore((s) => s.omniOpen);
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const homeView = useUIStore((s) => s.homeView);
  const activeNav = useUIStore((s) => s.activeNav);
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const dockedPanelWidth = useUIStore((s) => s.dockedPanelWidth);
  const inVault = !homeView;
  const inTerminal = activeNav === "terminal";
  const showVaultChrome = inVault && !inTerminal && !sftpPanelOpen;
  // Sidebar visible ⇒ content floats as a raised slab on the recessed frame.
  const showFrame = !inTerminal && !sftpPanelOpen;

  return (
    <>
      <TitleBar />
      <EmailVerificationBanner />
      <div className="flex flex-1 overflow-hidden" data-shell-body>
        {showFrame && <VaultSidebar />}
        <div
          className={`flex flex-col flex-1 overflow-hidden bg-(--t-bg-terminal) relative z-10 ${showFrame ? "chrome-slab" : ""}`}
        >
          {showVaultChrome && (
            <div className="shrink-0 relative z-10" style={{ background: "var(--t-bg-chrome)" }}>
              <PreviewContentScope>
                <VaultHeader />
                <NavBar />
              </PreviewContentScope>
              {previewing && <ViewAsBanner />}
            </div>
          )}
          <div className="flex flex-1 overflow-hidden" data-shell-content style={{ paddingRight: dockedPanelWidth || undefined }}>
            <HostSessionsPanel />
            <PreviewContentScope>
              <MainPanel />
            </PreviewContentScope>
            {previewing && <ViewAsSidePanel />}
            <RightPanel />
          </div>
        </div>
      </div>
      {previewing && <ViewAsPill />}
      {omniOpen && <OmniSearch onClose={() => setOmniOpen(false)} />}
      <GlobalPanelHost />
    </>
  );
}
