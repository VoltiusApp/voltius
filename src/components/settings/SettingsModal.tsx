import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { Modal } from "@/components/shared/Modal";
import AppearanceSection from "@/components/settings/sections/AppearanceSection";
import AccountSection from "@/components/settings/sections/AccountSection";
import SyncSection from "@/components/settings/sections/SyncSection";
import VaultsSection from "@/components/settings/sections/VaultsSection";
import PluginsSection from "@/components/settings/sections/PluginsSection";
import SFTPSection from "@/components/settings/sections/SFTPSection";
import PortForwardingSection from "@/components/settings/sections/PortForwardingSection";
import AboutSection from "@/components/settings/sections/AboutSection";
import HostsSection from "@/components/settings/sections/HostsSection";
import ShortcutsSection from "@/components/settings/sections/ShortcutsSection";
import { SETTINGS_NAV } from "@/components/settings/settingsNav";

export default function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const setSection = useUIStore((s) => s.setSettingsSection);

  if (!open) return null;

  return (
    <Modal onClose={() => setOpen(false)} blur>
      <div
        className="surface-modal-solid rounded-[var(--r-lg)] flex overflow-hidden animate-fadeIn"
        style={{
          width: "min(60rem, 92vw)",
          height: "min(38.667rem, 88vh)",
        }}
      >
        <nav
          className="flex flex-col shrink-0 py-4 bg-(--t-bg-toolbar) border-r border-r-(--t-border)"
          style={{ width: "13.333rem" }}
        >
          <div className="px-5 mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
              Settings
            </span>
          </div>

          <div className="flex-1 px-2 space-y-0.5">
            {SETTINGS_NAV.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                  style={{
                    background: active ? "var(--t-bg-input)" : "transparent",
                    color: active ? "var(--t-text-bright)" : "var(--t-text-secondary)",
                    fontWeight: active ? 500 : 400,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon icon={item.icon} width={15} className="shrink-0" style={{ color: active ? "var(--t-accent)" : "inherit" }} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="px-4 pt-3 border-t border-t-(--t-border)">
            <span className="text-xs text-(--t-text-dim)">Ctrl+, to open</span>
          </div>
        </nav>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 shrink-0 border-b border-b-(--t-border)"
          >
            <span className="text-sm font-semibold text-(--t-text-bright)">
              {SETTINGS_NAV.find((n) => n.id === section)?.label}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg transition-colors text-(--t-text-muted)"
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
            >
              <Icon icon="lucide:x" width={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {section === "appearance" && <AppearanceSection />}
            {section === "account" && <AccountSection />}
            {section === "sync" && <SyncSection />}
            {section === "vaults" && <VaultsSection />}
            {section === "plugins" && <PluginsSection />}
            {section === "sftp" && <SFTPSection />}
            {section === "portForwarding" && <PortForwardingSection />}
            {section === "hosts" && <HostsSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
