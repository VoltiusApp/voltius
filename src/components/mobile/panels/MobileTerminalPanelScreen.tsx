import { useMobileNavStore } from "@/stores/mobileNavStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useCloseWhenGone } from "@/hooks/useCloseWhenGone";
import { sessionLabel } from "@/utils/sessionLabel";
import { pluginSectionIdOf, useTerminalPanels } from "@/components/terminal/terminalPanels";
import { TerminalPanelBody } from "@/components/terminal/RightPanel";
import MobilePanelHeader from "./MobilePanelHeader";

/** A terminal side panel on a phone: the plugin's own mobile screen when it registered one
 *  under the section's id, otherwise the desktop panel under a page header. */
export default function MobileTerminalPanelScreen({ section, sessionId }: { section: string; sessionId: string }) {
  const pop = useMobileNavStore((s) => s.pop);
  const panel = useTerminalPanels().find((p) => p.id === section);
  const pluginSectionId = pluginSectionIdOf(section);
  const pluginScreen = usePluginStore((s) => (pluginSectionId ? s.mobileScreens.get(pluginSectionId) : undefined));
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  useCloseWhenGone(section, !!panel, pop);
  if (!panel) return null;

  if (pluginScreen) {
    const Render = pluginScreen.render;
    return <Render sessionId={sessionId} onBack={pop} />;
  }
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)" data-mobile-terminal-panel={section}>
      <MobilePanelHeader title={panel.title} sessionName={session ? sessionLabel(session) : undefined} />
      <div data-vt-hit-scope className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <TerminalPanelBody section={panel.id} onInjected={pop} />
      </div>
    </div>
  );
}
