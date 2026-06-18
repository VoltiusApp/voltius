import TitleBar from "@/components/layout/TitleBar";
import VaultSidebar from "@/components/layout/VaultSidebar";
import VaultHeader from "@/components/layout/VaultHeader";
import NavBar from "@/components/layout/NavBar";
import MainPanel from "@/components/layout/MainPanel";
import OmniSearch from "@/components/omni/OmniSearch";
import RightPanel from "@/components/terminal/RightPanel";
import { EmailVerificationBanner } from "@/components/notifications/EmailVerificationBanner";
import { useUIStore } from "@/stores/uiStore";

export default function DesktopShell() {
  const omniOpen = useUIStore((s) => s.omniOpen);
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const homeView = useUIStore((s) => s.homeView);
  const activeNav = useUIStore((s) => s.activeNav);
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const inVault = !homeView;
  const inTerminal = activeNav === "terminal";
  const showVaultChrome = inVault && !inTerminal && !sftpPanelOpen;
  // Sidebar visible ⇒ content floats as a raised slab on the recessed frame.
  const showFrame = !inTerminal && !sftpPanelOpen;

  return (
    <>
      <TitleBar />
      <EmailVerificationBanner />
      <div className="flex flex-1 overflow-hidden">
        {showFrame && <VaultSidebar />}
        <div
          className={`flex flex-col flex-1 overflow-hidden bg-(--t-bg-terminal) relative z-10 ${showFrame ? "chrome-slab" : ""}`}
        >
          {showVaultChrome && (
            <div className="shrink-0 relative z-10" style={{ background: "var(--t-bg-chrome)" }}>
              <VaultHeader />
              <NavBar />
            </div>
          )}
          <div className="flex flex-1 overflow-hidden">
            <MainPanel />
            <RightPanel />
          </div>
        </div>
      </div>
      {omniOpen && <OmniSearch onClose={() => setOmniOpen(false)} />}
    </>
  );
}
