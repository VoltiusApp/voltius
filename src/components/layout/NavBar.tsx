import { Icon } from "@iconify/react";
import { useUIStore, type NavItem } from "@/stores/uiStore";
import { useRipple } from "@/hooks/useRipple";

interface NavEntry {
  id: NavItem;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavEntry[] = [
  { id: "hosts",           label: "Hosts",           icon: "lucide:server" },
  { id: "keychain",        label: "Keychain",        icon: "lucide:key-round" },
  { id: "port-forwarding", label: "Port Forwarding", icon: "lucide:arrow-right-left" },
  { id: "snippets",        label: "Snippets",        icon: "lucide:braces" },
  { id: "known-hosts",     label: "Known Hosts",     icon: "lucide:fingerprint" },
  { id: "members",         label: "Members",         icon: "lucide:users-round" },
  { id: "logs",            label: "Logs",            icon: "lucide:scroll-text" },
];

export default function NavBar() {
  const activeNav = useUIStore((s) => s.activeNav);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const setSftpPanelOpen = useUIStore((s) => s.setSftpPanelOpen);

  const handleNav = (id: NavItem) => {
    setSftpPanelOpen(false);
    setActiveNav(id);
  };

  return (
    <div
      className="flex items-center shrink-0 px-2 border-b gap-0.5"
      style={{
        height: "2.75rem",
        background: "var(--t-bg-toolbar)",
        borderColor: "var(--t-border)",
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = activeNav === item.id;
        return (
          <NavTabButton
            key={item.id}
            item={item}
            isActive={isActive}
            onClick={() => handleNav(item.id)}
          />
        );
      })}
    </div>
  );
}

function NavTabButton({
  item,
  isActive,
  onClick,
}: {
  item: NavEntry;
  isActive: boolean;
  onClick: () => void;
}) {
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      onClick={onClick}
      onMouseDown={createRipple}
      className="relative flex items-center gap-2 px-3 h-full text-sm font-medium shrink-0 transition-colors overflow-hidden"
      style={{
        color: isActive ? "var(--t-text-primary)" : "var(--t-text-dim)",
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
      }}
      onMouseLeave={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
      }}
    >
      {rippleEls}
      <Icon icon={item.icon} width={15} className="shrink-0" />
      <span>{item.label}</span>
      {isActive && (
        <span
          className="absolute bottom-0 left-0 right-0 rounded-t-full"
          style={{ height: 2, background: "var(--t-accent)" }}
        />
      )}
    </button>
  );
}
