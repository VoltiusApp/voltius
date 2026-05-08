import { useState } from "react";
import { Icon } from "@iconify/react";
import { DashboardHero } from "./DashboardHero";
import { RecentHostsSection } from "./RecentHostsSection";
import { VaultsOverview } from "./VaultsOverview";
import { TeamSessions } from "@/components/hosts/TeamSessions";
import { AllHostsView } from "./AllHostsView";
import { useUIStore } from "@/stores/uiStore";

function QuickActions() {
  const openImportExport = useUIStore((s) => s.openImportExport);

  const actions = [
    { icon: "lucide:upload", label: "Export", onClick: () => openImportExport("export") },
    { icon: "lucide:download", label: "Import", onClick: () => openImportExport("import") },
  ];

  return (
    <div className="flex gap-2 mb-6">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors"
          style={{
            background: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            color: "var(--t-text-secondary)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--t-accent)";
            e.currentTarget.style.color = "var(--t-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--t-border)";
            e.currentTarget.style.color = "var(--t-text-secondary)";
          }}
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
    <div className="h-full overflow-y-auto bg-[var(--t-bg-base)]">
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
