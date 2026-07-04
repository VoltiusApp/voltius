import type { SettingsSection } from "@/stores/uiStore";
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
import DiagnosticsSection from "@/components/settings/sections/DiagnosticsSection";

/** Single source of truth for section id → body. Used by desktop and mobile shells. */
export function renderSettingsSection(section: SettingsSection) {
  switch (section) {
    case "appearance": return <AppearanceSection />;
    case "account": return <AccountSection />;
    case "sync": return <SyncSection />;
    case "vaults": return <VaultsSection />;
    case "plugins": return <PluginsSection />;
    case "sftp": return <SFTPSection />;
    case "portForwarding": return <PortForwardingSection />;
    case "hosts": return <HostsSection />;
    case "shortcuts": return <ShortcutsSection />;
    case "diagnostics": return <DiagnosticsSection />;
    case "about": return <AboutSection />;
    default: return null;
  }
}
