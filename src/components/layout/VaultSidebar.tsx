import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { onVaultSelect } from "@/services/teamDataManager";
import LogoBadge from "./LogoBadge";
import { useUIStore } from "@/stores/uiStore";
import { useRipple } from "@/hooks/useRipple";
import { SidebarAccountButton } from "./SidebarAccountButton";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { CreateVaultModal } from "@/components/shared/CreateVaultModal";
import { Modal } from "@/components/shared/Modal";
import { openBillingCheckout } from "@/services/billingCheckout";
import {
  acceptMyPendingInvitation,
  declineMyPendingInvitation,
} from "@/services/teamService";
import type { MyPendingInvitation } from "@/stores/teamStore";

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
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);

  const teams = useTeamStore((s) => s.teams);
  const pendingInvites = useTeamStore((s) => s.myPendingInvitations);
  const loadMyPendingInvitations = useTeamStore((s) => s.loadMyPendingInvitations);
  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  const standaloneTeams = teams.filter((t) => !linkedTeamIds.has(t.id));

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showVaultLimitModal, setShowVaultLimitModal] = useState(false);
  const [selectedInvite, setSelectedInvite] = useState<MyPendingInvitation | null>(null);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const isCloudAccount = accountMode === "server";

  useEffect(() => {
    if (!isCloudAccount) return;
    loadMyPendingInvitations().catch(() => {});
  }, [isCloudAccount, loadMyPendingInvitations]);

  const handleAddVaultClick = () => {
    if (!isPro && vaults.length >= 1) {
      setShowVaultLimitModal(true);
      return;
    }
    setShowCreateModal(true);
  };

  const handleUpgradePro = async () => {
    if (await openBillingCheckout("pro")) setShowVaultLimitModal(false);
  };

  const handleCreateVault = (name: string) => {
    const vault = addVault(name);
    selectVaultOnly(vault.id);
    setHomeView(false);
    setShowCreateModal(false);
  };

  return (
    <aside
      className="flex flex-col shrink-0 items-center gap-2.5 overflow-hidden"
      style={{ width: "4.75rem", background: "var(--t-bg-terminal)" }}
    >
      {/* App icon */}
      <AppIconButton isActive={homeView} onClick={() => setHomeView(true)} />

      <div className="w-7 h-px my-1 shrink-0" style={{ background: "var(--t-border)" }} />

      <div
        data-testid="vault-sidebar-scroll-area"
        className="flex flex-col items-center gap-2.5 min-h-0 overflow-y-auto overflow-x-hidden w-full scrollbar-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {/* Local vault buttons */}
        {vaults.map((vault) => {
          const isActive = selectedVaultIds.includes(vault.id) && !homeView;
          return (
            <div key={vault.id} className="relative flex items-center justify-center w-full shrink-0">
              <VaultButton
                initial={getInitials(vault.name)}
                label={vault.teamId ? `${vault.name} (Cloud vault)` : vault.name}
                isActive={isActive}
                onClick={() => {
                  selectVaultOnly(vault.id);
                  setHomeView(false);
                  if (vault.teamId) onVaultSelect(vault.teamId).catch(() => {});
                }}
              />
              {vault.teamId && <TeamVaultBadge teamId={vault.teamId} />}
            </div>
          );
        })}

        {/* Pending vault invitations */}
        {pendingInvites.map((inv) => (
          <div key={inv.id} className="relative flex items-center justify-center w-full shrink-0">
            <PendingInviteButton invite={inv} onClick={() => setSelectedInvite(inv)} />
          </div>
        ))}

        {/* Standalone team vault buttons (invited members who have no linked local vault) */}
        {standaloneTeams.map((team) => {
          const isActive = selectedVaultIds.includes(team.id) && !homeView;
          return (
            <div key={team.id} className="relative flex items-center justify-center w-full shrink-0">
              <VaultButton
                initial={getInitials(team.name)}
                label={`${team.name} (Cloud vault)`}
                isActive={isActive}
                onClick={() => {
                  selectVaultOnly(team.id);
                  setHomeView(false);
                  onVaultSelect(team.id).catch(() => {});
                }}
              />
              <TeamVaultBadge teamId={team.id} />
            </div>
          );
        })}

        {/* Add vault */}
        <AddVaultButton onClick={handleAddVaultClick} />
      </div>

      {showCreateModal && (
        <CreateVaultModal
          onConfirm={handleCreateVault}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      {selectedInvite && (
        <PendingInviteModal
          invite={selectedInvite}
          onAccept={async () => {
            await acceptMyPendingInvitation(selectedInvite.id);
            const acceptedTeamId = selectedInvite.team_id;
            setSelectedInvite(null);
            // loadTeams() + loadMyPendingInvitations() run in parallel with vault load.
            // We also call joinAndLoadTeamVault directly because loadTeams() below will
            // add the team to the store before the SSE membership_changed event is
            // processed — causing handleMembershipChangedEvent to see a zero delta and
            // skip onTeamAdded entirely, leaving status stuck at "forbidden".
            const { joinAndLoadTeamVault } = await import("@/services/teamDataManager");
            await Promise.all([
              useTeamStore.getState().loadTeams(),
              useTeamStore.getState().loadMyPendingInvitations(),
              joinAndLoadTeamVault(acceptedTeamId),
            ]);
          }}
          onDecline={async () => {
            await declineMyPendingInvitation(selectedInvite.id);
            setSelectedInvite(null);
            await useTeamStore.getState().loadMyPendingInvitations();
          }}
          onClose={() => setSelectedInvite(null)}
        />
      )}

      {showVaultLimitModal && (
        <VaultLimitModal
          isCloudAccount={isCloudAccount}
          onClose={() => setShowVaultLimitModal(false)}
          onSignIn={() => {
            setShowVaultLimitModal(false);
            openCloudAuth("signin");
          }}
          onUpgrade={() => void handleUpgradePro()}
        />
      )}

      <div className="flex-1" />

      {/* Account */}
      <SidebarAccountButton />

      {/* Settings */}
      <SettingsButton onClick={() => openSettings()} />
    </aside>
  );
}

function PendingInviteButton({ invite, onClick }: { invite: MyPendingInvitation; onClick: () => void }) {
  const { createRipple, rippleEls } = useRipple();
  const [hovered, setHovered] = useState(false);
  const initial = invite.team_name.trim().charAt(0).toUpperCase();
  return (
    <div
      className="relative flex items-center justify-center w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && <ActivePip active={false} />}
      <button
        onClick={onClick}
        onMouseDown={createRipple}
        title={`Vault invite: ${invite.team_name}`}
        className="flex items-center justify-center text-base font-bold relative overflow-hidden transition-all"
        style={{
          width: 44,
          height: 44,
          background: hovered ? "rgba(245,158,11,0.2)" : "var(--t-bg-elevated)",
          color: "var(--t-text-dim)",
          borderRadius: hovered ? "0.75rem" : "1.375rem",
          border: "2px dashed rgba(245,158,11,0.5)",
          opacity: 0.8,
          transition: "border-radius 200ms, background 200ms",
        }}
      >
        {rippleEls}
        {initial}
      </button>
      <span
        className="absolute bottom-0.5 right-0.5 flex items-center justify-center rounded-full pointer-events-none"
        style={{ width: 14, height: 14, background: "var(--t-bg-terminal)" }}
      >
        <Icon icon="lucide:clock" width={9} style={{ color: "#f59e0b" }} />
      </span>
    </div>
  );
}

function PendingInviteModal({
  invite,
  onAccept,
  onDecline,
  onClose,
}: {
  invite: MyPendingInvitation;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");

  const handle = async (action: "accept" | "decline") => {
    setLoading(action);
    setError("");
    try {
      if (action === "accept") await onAccept();
      else await onDecline();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(null);
    }
  };

  return (
    <Modal onClose={onClose} blur>
      <div
        className="flex flex-col gap-5 p-6"
        style={{ width: "min(22rem, 92vw)", background: "var(--t-bg-base)", border: "1px solid var(--t-border)", borderRadius: "0.933rem", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <Icon icon="lucide:vault" width={20} style={{ color: "#f59e0b" }} />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-(--t-text-primary) mb-0.5">Vault invitation</p>
            <p className="text-sm text-(--t-text-muted) leading-relaxed">
              <span className="text-(--t-text-primary) font-medium">{invite.inviter_display_name ?? "Someone"}</span>
              {" "}invited you to{" "}
              <span className="text-(--t-text-primary) font-medium">{invite.team_name}</span>
              {" "}as <span className="capitalize font-medium" style={{ color: "var(--t-accent)" }}>{invite.role}</span>.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", color: "var(--t-status-error)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => void handle("accept")}
            disabled={!!loading}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-opacity"
            style={{ background: "var(--t-accent)", color: "#fff", opacity: loading ? 0.6 : 1 }}
          >
            {loading === "accept" ? "Accepting…" : "Accept"}
          </button>
          <button
            onClick={() => void handle("decline")}
            disabled={!!loading}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)", opacity: loading ? 0.6 : 1 }}
          >
            {loading === "decline" ? "Declining…" : "Decline"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function VaultLimitModal({
  isCloudAccount,
  onClose,
  onSignIn,
  onUpgrade,
}: {
  isCloudAccount: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onUpgrade: () => void;
}) {
  return (
    <Modal onClose={onClose} blur>
      <div
        className="flex flex-col gap-4 bg-(--t-bg-base) border border-(--t-border) p-6"
        style={{ width: "min(25rem, 92vw)", borderRadius: "0.933rem", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
          >
            <Icon icon="lucide:vault" width={20} style={{ color: "var(--t-accent)" }} />
          </div>
          <div>
            <p className="text-base font-semibold text-(--t-text-primary) mb-1">
              Multiple vaults require Pro
            </p>
            <p className="text-sm text-(--t-text-muted) leading-relaxed">
              Free accounts can create one vault. Upgrade to Pro to organize your credentials across multiple vaults.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={isCloudAccount ? onUpgrade : onSignIn}
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-(--t-accent) text-white hover:opacity-90 transition-opacity"
          >
            {isCloudAccount ? "Upgrade to Pro" : "Sign in or create cloud account"}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-sm text-(--t-text-muted) hover:text-(--t-text-primary) transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TeamVaultBadge({ teamId }: { teamId: string }) {
  const status = useTeamVaultStateStore((s) => s.statusByTeamId[teamId] ?? "idle");

  let icon: string;
  let spin = false;
  let opacity = 1;

  const isError = status === "error" || status === "not_found" || status === "forbidden" || status === "payment_required";

  if (status === "loading") {
    icon = "lucide:loader";
    spin = true;
  } else if (status === "offline") {
    icon = "lucide:cloud-off";
    opacity = 0.5;
  } else if (isError) {
    icon = "lucide:triangle-alert";
  } else {
    icon = "lucide:cloud";
  }

  return (
    <span
      className="absolute bottom-0.5 right-0.5 flex items-center justify-center rounded-full pointer-events-none"
      style={{
        width: 14,
        height: 14,
        background: "var(--t-bg-terminal)",
        opacity,
      }}
    >
      <Icon
        icon={icon}
        width={10}
        className={spin ? "animate-spin" : undefined}
        style={{ color: spin ? "var(--t-accent)" : isError ? "#f59e0b" : "var(--t-text-dim)" }}
      />
    </span>
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
  const borderRadius = isActive || hovered ? "0.75rem" : "1.375rem";
  return (
    <div
      className="relative flex items-center justify-center w-full shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {(isActive || hovered) && <ActivePip active={isActive} />}
      <button
        onClick={onClick}
        onMouseDown={createRipple}
        title="Home"
        className="relative overflow-hidden"
        style={{ background: "none", border: "none", padding: 0 }}
      >
        {rippleEls}
        <LogoBadge size={11} active={isActive} borderRadius={borderRadius} />
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
      className="flex items-center justify-center mb-3 relative overflow-hidden transition-all shrink-0"
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
      className="flex items-center justify-center relative overflow-hidden transition-all shrink-0"
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
