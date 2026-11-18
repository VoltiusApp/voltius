import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RecentHostsSection } from "./RecentHostsSection";
import { VaultsOverview } from "./VaultsOverview";
import { TeamSessions } from "@/components/hosts/TeamSessions";
import { AllHostsView } from "./AllHostsView";
import { FirstRunPanel, TextLink } from "./FirstRunPanel";
import { ConnectPrompt, useNewHost } from "./ConnectPrompt";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useShortcutHint } from "@/stores/shortcutStore";
import { useAllConnections } from "@/hooks/useAllConnections";

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return "home.greeting.morning";
  if (h < 18) return "home.greeting.afternoon";
  return "home.greeting.evening";
}

function LauncherBar() {
  const { t } = useTranslation();
  const openImportExport = useUIStore((s) => s.openImportExport);
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const omniHint = useShortcutHint("omni");
  const newHost = useNewHost();

  return (
    <section aria-label={t("home.connect.label")} className="mb-8">
      <ConnectPrompt placeholder={t("home.connect.placeholder")} searchFallback />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-1">
        <TextLink icon="lucide:plus" label={t("hosts.toolbar.newHost")} onClick={newHost} />
        <TextLink icon="lucide:download" label={t("home.quickActions.import")} onClick={() => openImportExport("import")} />
        <TextLink icon="lucide:upload" label={t("home.quickActions.export")} onClick={() => openImportExport("export")} />
        {omniHint && (
          <button
            type="button"
            onClick={() => setOmniOpen(true)}
            className="ml-auto flex items-center gap-1.5 text-xs text-(--t-text-dim) hover:text-(--t-accent) transition-colors"
          >
            {t("home.connect.searchEverything")}
            <kbd className="font-mono text-xs px-1.5 py-0.5 rounded-sm bg-(--t-bg-elevated) border border-(--t-border)">{omniHint}</kbd>
          </button>
        )}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { t } = useTranslation();
  const [subView, setSubView] = useState<"all-hosts" | null>(null);
  const firstRun = useAllConnections().length === 0;
  const inTeam = useTeamStore((s) => s.teams.length > 0);
  const hasLiveSessions = useTeamSessionStore((s) => s.activeSessions.length > 0);

  if (subView === "all-hosts") {
    return <AllHostsView onBack={() => setSubView(null)} />;
  }

  return (
    <div className="h-full overflow-y-auto chrome-canvas focus-ring-scope">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <h1 className="text-2xl font-semibold mb-6 text-(--t-text-primary)">{t(greetingKey())}</h1>
        {firstRun ? <FirstRunPanel /> : <LauncherBar />}
        {(inTeam || hasLiveSessions) && <TeamSessions />}
        <RecentHostsSection onSeeAll={() => setSubView("all-hosts")} />
        {(!firstRun || inTeam) && <VaultsOverview />}
      </div>
    </div>
  );
}
