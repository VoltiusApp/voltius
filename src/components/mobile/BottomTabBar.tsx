import { Icon } from "@iconify/react";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { MobileTab } from "@/stores/mobileNavCore";

const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: "hosts",    label: "Hosts",    icon: "lucide:server" },
  { id: "terminal", label: "Terminal", icon: "lucide:square-terminal" },
  { id: "snippets", label: "Snippets", icon: "lucide:braces" },
  { id: "files",    label: "Files",    icon: "lucide:folder" },
  { id: "more",     label: "More",     icon: "lucide:menu" },
];

export default function BottomTabBar() {
  const tab = useMobileNavStore((s) => s.tab);
  const setTab = useMobileNavStore((s) => s.setTab);
  const sessionCount = useSessionStore((s) => s.sessions.length);

  return (
    <nav
      className="shrink-0 flex border-t"
      style={{
        background: "var(--t-bg-chrome)",
        borderColor: "var(--t-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            data-mobile-tab={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative"
            style={{ color: active ? "var(--t-accent)" : "var(--t-text-dim)" }}
          >
            <span className="relative">
              <Icon icon={t.icon} width={22} />
              {t.id === "terminal" && sessionCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
                  style={{ background: "var(--t-accent)", color: "#fff" }}
                >
                  {sessionCount}
                </span>
              )}
            </span>
            <span className="text-[11px] font-medium">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
