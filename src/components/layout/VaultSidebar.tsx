import { Icon } from "@iconify/react";
import { useState } from "react";
import logoUrl from "/logo.svg";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useRipple } from "@/hooks/useRipple";
import { SidebarAccountButton } from "./SidebarAccountButton";

function getInitials(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

export default function VaultSidebar() {
  const vaults = useVaultStore((s) => s.vaults);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const selectVaultOnly = useVaultStore((s) => s.selectVaultOnly);
  const addVault = useVaultStore((s) => s.addVault);
  const homeView = useUIStore((s) => s.homeView);
  const setHomeView = useUIStore((s) => s.setHomeView);
  const openSettings = useUIStore((s) => s.openSettings);

  const handleAddVault = () => {
    const name = window.prompt("Vault name:");
    if (name?.trim()) {
      const vault = addVault(name.trim());
      selectVaultOnly(vault.id);
    }
  };

  return (
    <aside
      className="flex flex-col shrink-0 items-center gap-2.5 overflow-y-auto overflow-x-hidden"
      style={{ width: "4.75rem", background: "var(--t-bg-terminal)" }}
    >
      {/* App icon */}
      <AppIconButton isActive={homeView} onClick={() => setHomeView(true)} />

      <div className="w-7 h-px my-1" style={{ background: "var(--t-border)" }} />

      {/* Vault buttons */}
      {vaults.map((vault) => {
        const isActive = selectedVaultIds.includes(vault.id) && !homeView;
        return (
          <VaultButton
            key={vault.id}
            initial={getInitials(vault.name)}
            label={vault.name}
            isActive={isActive}
            onClick={() => {
              selectVaultOnly(vault.id);
              setHomeView(false);
            }}
          />
        );
      })}

      {/* Add vault */}
      <AddVaultButton onClick={handleAddVault} />

      <div className="flex-1" />

      {/* Account */}
      <SidebarAccountButton onOpenSettings={(tab) => openSettings(tab)} />

      {/* Settings */}
      <SettingsButton onClick={() => openSettings()} />
    </aside>
  );
}

function ActivePip({ active }: { active: boolean }) {
  return (
    <span
      className="absolute left-0 rounded-r-full"
      style={{
        width: 4,
        height: active ? 40 : 20,
        background: "var(--t-text-primary)",
        transition: "height 150ms ease",
      }}
    />
  );
}

function AppIconButton({ isActive, onClick }: { isActive: boolean; onClick: () => void }) {
  const { createRipple, rippleEls } = useRipple();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex items-center justify-center w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {(isActive || hovered) && <ActivePip active={isActive} />}
      <button
        onClick={onClick}
        onMouseDown={createRipple}
        title="Home"
        className="flex items-center justify-center rounded-2xl relative overflow-hidden transition-all"
        style={{
          width: 44,
          height: 44,
          borderRadius: isActive ? "0.75rem" : "1.375rem",
          transition: "border-radius 200ms, background 200ms",
          backgroundColor: "#010318",
          border: "2px solid transparent",
          backgroundImage: isActive 
            ? "linear-gradient(#010318, #010318), linear-gradient(to right, #28A5F9, #E98757)" 
            : "none",
          backgroundOrigin: "border-box",
          backgroundClip: "padding-box, border-box",
          borderColor: "transparent"
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
            // (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent)";
            // (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
            // (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
            // (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)";
          }
        }}
      >
        {rippleEls}
        <img src={logoUrl} alt="Voltius" style={{ height: 32, width: "auto" }} />
      </button>
    </div>
  );
}

function VaultButton({
  initial,
  label,
  isActive,
  onClick,
}: {
  initial: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const { createRipple, rippleEls } = useRipple();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex items-center justify-center w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {(isActive || hovered) && <ActivePip active={isActive} />}
      <button
        onClick={onClick}
        onMouseDown={createRipple}
        title={label}
        className="flex items-center justify-center text-base font-bold relative overflow-hidden transition-all"
        style={{
          width: 44,
          height: 44,
          background: isActive ? "var(--t-accent)" : "var(--t-bg-elevated)",
          color: isActive ? "#fff" : "var(--t-text-secondary)",
          borderRadius: isActive ? "0.75rem" : "1.375rem",
          transition: "border-radius 200ms, background 200ms",
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
            (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent)";
            (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
            (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
          }
        }}
      >
        {rippleEls}
        {initial}
      </button>
    </div>
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      onClick={onClick}
      onMouseDown={createRipple}
      title="Settings"
      className="flex items-center justify-center mb-3 relative overflow-hidden transition-all"
      style={{
        width: 44,
        height: 44,
        borderRadius: "1.375rem",
        background: "transparent",
        color: "var(--t-text-dim)",
        transition: "border-radius 200ms, background 200ms, color 200ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
        (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
      }}
    >
      {rippleEls}
      <Icon icon="lucide:settings" width={20} />
    </button>
  );
}

function AddVaultButton({ onClick }: { onClick: () => void }) {
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      onClick={onClick}
      onMouseDown={createRipple}
      title="Add vault"
      className="flex items-center justify-center relative overflow-hidden transition-all"
      style={{
        width: 44,
        height: 44,
        borderRadius: "1.375rem",
        border: "2px dashed var(--t-border)",
        background: "transparent",
        color: "var(--t-text-dim)",
        transition: "border-radius 200ms, background 200ms, color 200ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
      }}
    >
      {rippleEls}
      <Icon icon="lucide:plus" width={20} />
    </button>
  );
}
