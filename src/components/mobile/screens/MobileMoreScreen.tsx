import { Icon } from "@iconify/react";
import MobileHeader from "../MobileHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import type { MorePage } from "@/stores/mobileNavCore";

const PAGES: { page: MorePage; label: string; icon: string }[] = [
  { page: "keychain",        label: "Keychain",        icon: "lucide:key-round" },
  { page: "port-forwarding", label: "Port Forwarding", icon: "lucide:arrow-left-right" },
  { page: "known-hosts",     label: "Known Hosts",     icon: "lucide:fingerprint" },
  { page: "members",         label: "Members",         icon: "lucide:users-round" },
  { page: "logs",            label: "Logs",            icon: "lucide:scroll-text" },
];

export default function MobileMoreScreen() {
  const push = useMobileNavStore((s) => s.push);
  const openSettings = useUIStore((s) => s.openSettings);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader title="More" />
      <div className="flex-1 overflow-y-auto py-2">
        {PAGES.map((p) => (
          <button key={p.page} data-more-page={p.page}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card)"
            onClick={() => push({ kind: "more-page", page: p.page })}>
            <Icon icon={p.icon} width={20} className="text-(--t-text-dim)" />
            <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{p.label}</span>
            <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim)" />
          </button>
        ))}
        <div className="mx-4 my-2 border-t" style={{ borderColor: "var(--t-border)" }} />
        <button data-more-page="settings"
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card)"
          onClick={() => openSettings()}>
          <Icon icon="lucide:settings" width={20} className="text-(--t-text-dim)" />
          <span className="flex-1 text-sm font-medium text-(--t-text-primary)">Settings</span>
        </button>
      </div>
    </div>
  );
}
