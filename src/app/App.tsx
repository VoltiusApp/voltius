import { useEffect, useState } from "react";
import TitleBar from "@/components/layout/TitleBar";
import VaultSidebar from "@/components/layout/VaultSidebar";
import VaultHeader from "@/components/layout/VaultHeader";
import NavBar from "@/components/layout/NavBar";
import MainPanel from "@/components/layout/MainPanel";
import SplashScreen from "@/components/layout/SplashScreen";
import OmniSearch from "@/components/omni/OmniSearch";
import SettingsModal from "@/components/settings/SettingsModal";
import { ImportExportModal } from "@/components/import-export/ImportExportModal";
import RightPanel from "@/components/terminal/RightPanel";
import { SnippetVariableModal } from "@/components/terminal/SnippetVariableModal";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useInputUndo } from "@/hooks/useInputUndo";
import { useSessionExpiration } from "@/hooks/useSessionExpiration";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { useApplyUiScale } from "@/hooks/useApplyUiScale";
import { useCoreOmniCommands } from "@/hooks/useCoreOmniCommands";
import { useImportExportContributions } from "@/hooks/useImportExportContributions";
import { useConnectionPresenceBroadcast } from "@/hooks/useConnectionPresenceBroadcast";
import { useChangelogAutoOpen } from "@/hooks/useChangelogAutoOpen";
import { useUIStore } from "@/stores/uiStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSessionStore } from "@/stores/sessionStore";
import { broadcastSnippetInject } from "@/services/snippets";
import { initUpdaterListener } from "@/services/updater";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { restoreWorkspaceOnLaunch } from "@/stores/workspaceRestore";
import { startLiveSessionPublisher } from "@/services/liveSessionPublisher";
import { startCrossDeviceSessions } from "@/services/crossDeviceSessions";
import { NotificationToastContainer } from "@/components/notifications/NotificationToastContainer";
import ThemeCreator from "@/components/theme-creator/ThemeCreator";
import { TrialExpiredModal } from "@/components/shared/TrialExpiredModal";
import CloudAuthModal from "@/components/layout/CloudAuthModal";
import WhatsNewModal from "@/components/changelog/WhatsNewModal";
import { EmailVerificationBanner } from "@/components/notifications/EmailVerificationBanner";
import { EmailVerificationRequiredModal } from "@/components/notifications/EmailVerificationRequiredModal";
import { GlobalTransferQueue } from "@/components/filetransfer/GlobalTransferQueue";

function App() {
  const [ready, setReady] = useState(false);
  useKeyboard();
  useInputUndo();
  useSessionExpiration();
  useApplyTheme();
  useApplyUiScale();
  useCoreOmniCommands();
  useImportExportContributions();
  useConnectionPresenceBroadcast();
  useChangelogAutoOpen();
  useEffect(() => { initUpdaterListener(); useUpdaterPrefStore.getState().load(); }, []);
  useEffect(() => {
    if (ready) {
      void restoreWorkspaceOnLaunch().then(() => {
        startLiveSessionPublisher();
        startCrossDeviceSessions();
      });
    }
  }, [ready]);
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
  const globalPendingInject = useSnippetStore((s) => s.globalPendingInject);
  const setGlobalPendingInject = useSnippetStore((s) => s.setGlobalPendingInject);
  const { sessions } = useSessionStore();

  if (!ready) {
    return <SplashScreen onReady={() => setReady(true)} />;
  }

  return (
    <div className="chrome-frame h-full w-full flex flex-col overflow-hidden animate-fadeIn">
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
      <SettingsModal />
      <ImportExportModal />

      <NotificationToastContainer />
      <ThemeCreator />
      <TrialExpiredModal />
      <CloudAuthModal />
      <WhatsNewModal />
      <EmailVerificationRequiredModal />
      <GlobalTransferQueue />

      {/* Global snippet variable modal — triggered from OmniSearch */}
      {globalPendingInject && (
        <SnippetVariableModal
          snippetName={globalPendingInject.snippet.name}
          partialTemplate={globalPendingInject.partialTemplate}
          userVars={globalPendingInject.userVars}
          initialValues={globalPendingInject.initialValues}
          onInject={(resolvedText, execute) => {
            const activeSession = sessions.find(
              (s) => s.status === "connected" && s.type !== "multiplayer",
            );
            if (activeSession) {
              broadcastSnippetInject(activeSession.id, activeSession.type, resolvedText, execute).catch(console.error);
            }
            setGlobalPendingInject(null);
          }}
          onClose={() => setGlobalPendingInject(null)}
        />
      )}
    </div>
  );
}

export default App;
