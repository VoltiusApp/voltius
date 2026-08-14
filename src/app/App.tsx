import { useEffect, useState } from "react";
import DesktopShell from "@/components/layout/DesktopShell";
import MobileShell from "@/components/mobile/MobileShell";
import { usePlatform } from "@/utils/platform";
import SplashScreen from "@/components/layout/SplashScreen";
import SettingsModal from "@/components/settings/SettingsModal";
import { ImportExportModal } from "@/components/import-export/ImportExportModal";
import { SnippetVariableModal } from "@/components/terminal/SnippetVariableModal";
import { PendingSequenceModal } from "@/components/terminal/PendingSequenceModal";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useInputUndo } from "@/hooks/useInputUndo";
import { useSessionExpiration } from "@/hooks/useSessionExpiration";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { useThemeAutomation } from "@/hooks/useThemeAutomation";
import { useApplyUiScale } from "@/hooks/useApplyUiScale";
import { useCoreOmniCommands } from "@/hooks/useCoreOmniCommands";
import { useImportExportContributions } from "@/hooks/useImportExportContributions";
import { useConnectionPresenceBroadcast } from "@/hooks/useConnectionPresenceBroadcast";
import { useMcpServerSync } from "@/hooks/useMcpServerSync";
import { useChangelogAutoOpen } from "@/hooks/useChangelogAutoOpen";
import { useSnippetStore } from "@/stores/snippetStore";
import { injectPendingSnippet } from "@/services/snippetPendingInject";
import { initUpdaterListener } from "@/services/updater";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { restoreWorkspaceOnLaunch } from "@/stores/workspaceRestore";
import { startLiveSessionPublisher } from "@/services/liveSessionPublisher";
import { startCrossDeviceSessions } from "@/services/crossDeviceSessions";
import { startTeamInbox } from "@/services/teamInbox";
import { NotificationToastContainer } from "@/components/notifications/NotificationToastContainer";
import ThemeCreator from "@/components/theme-creator/ThemeCreator";
import { TrialExpiredModal } from "@/components/shared/TrialExpiredModal";
import CloudAuthModal from "@/components/layout/CloudAuthModal";
import WhatsNewModal from "@/components/changelog/WhatsNewModal";
import { EmailVerificationRequiredModal } from "@/components/notifications/EmailVerificationRequiredModal";
import { GlobalTransferQueue } from "@/components/filetransfer/GlobalTransferQueue";

function App() {
  const [ready, setReady] = useState(false);
  useKeyboard();
  useInputUndo();
  useSessionExpiration();
  useApplyTheme();
  useThemeAutomation();
  useApplyUiScale();
  useCoreOmniCommands();
  useImportExportContributions();
  useConnectionPresenceBroadcast();
  useMcpServerSync();
  useChangelogAutoOpen();
  useEffect(() => { initUpdaterListener(); useUpdaterPrefStore.getState().load(); }, []);
  useEffect(() => startTeamInbox(), []);
  useEffect(() => {
    if (ready) {
      void restoreWorkspaceOnLaunch().then(() => {
        startLiveSessionPublisher();
        startCrossDeviceSessions();
      });
    }
  }, [ready]);
  const platform = usePlatform();
  const globalPendingInject = useSnippetStore((s) => s.globalPendingInject);
  const setGlobalPendingInject = useSnippetStore((s) => s.setGlobalPendingInject);

  if (!ready) {
    return <SplashScreen onReady={() => setReady(true)} />;
  }

  if (platform === null) return null;
  const isMobileShell = platform === "android";

  return (
    <div className="chrome-frame h-full w-full flex flex-col overflow-hidden animate-fadeIn">
      {isMobileShell ? <MobileShell /> : <DesktopShell />}
      <SettingsModal />
      <ImportExportModal />

      <NotificationToastContainer />
      <ThemeCreator />
      <TrialExpiredModal />
      <CloudAuthModal />
      <WhatsNewModal />
      <EmailVerificationRequiredModal />
      <GlobalTransferQueue />

      {/* Global snippet variable modal — triggered from OmniSearch, the
          snippets page and the mobile snippet list */}
      {globalPendingInject && (
        <SnippetVariableModal
          snippetName={globalPendingInject.snippet.name}
          partialTemplate={globalPendingInject.partialTemplate}
          userVars={globalPendingInject.userVars}
          initialValues={globalPendingInject.initialValues}
          onInject={(resolvedText, execute) => {
            void injectPendingSnippet(globalPendingInject, resolvedText, execute);
            setGlobalPendingInject(null);
          }}
          onClose={() => setGlobalPendingInject(null)}
        />
      )}

      {/* Global snippet sequence variable modal */}
      <PendingSequenceModal />
    </div>
  );
}

export default App;
