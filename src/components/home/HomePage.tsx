import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { DashboardHero } from "./DashboardHero";
import { RecentHostsSection } from "./RecentHostsSection";
import { VaultsOverview } from "./VaultsOverview";
import { TeamSessions } from "@/components/hosts/TeamSessions";
import { AllHostsView } from "./AllHostsView";
import { useUIStore } from "@/stores/uiStore";

function QuickActions() {
  const { t } = useTranslation();
  const openImportExport = useUIStore((s) => s.openImportExport);

  const actions = [
    { icon: "lucide:upload", label: t("home.quickActions.export"), onClick: () => openImportExport("export") },
    { icon: "lucide:download", label: t("home.quickActions.import"), onClick: () => openImportExport("import") },
  ];

  return (
    <div className="flex gap-2 mb-6">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className="btn btn-secondary flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
        >
          <Icon icon={a.icon} width={14} />
          {a.label}
        </button>
      ))}
    </div>
  );
}

export default function HomePage() {
  const [subView, setSubView] = useState<"all-hosts" | null>(null);

  if (subView === "all-hosts") {
    return <AllHostsView onBack={() => setSubView(null)} />;
  }

  return (
    <div className="h-full overflow-y-auto chrome-canvas">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <DashboardHero />
        <QuickActions />
        <TeamSessions />
        <RecentHostsSection onSeeAll={() => setSubView("all-hosts")} />
        <VaultsOverview />
      </div>
    </div>
  );
}
