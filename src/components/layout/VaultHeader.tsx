import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import i18n from "@/i18n";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember } from "@/services/teamService";
import { AvatarOverflow, MiniAvatar } from "@/components/shared/AvatarStack";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { VaultShareSheet } from "@/components/vault-share/VaultShareSheet";
import { useVaultAdmin } from "@/components/vault-admin/useVaultAdmin";
import { VaultAdminSurface } from "@/components/vault-admin/VaultAdminSurface";
import type { VaultAdminTarget } from "@/components/vault-admin/vaultAdminTarget";

// ─── Members stack ─────────────────────────────────────────────────────────

const MAX_STACK = 3;

export function MembersStack({
  members,
  vaultId,
  vaultName,
  open: openProp,
  onOpenChange,
  hasTeam = true,
}: {
  members: TeamMember[];
  vaultId: string;
  vaultName: string;
  /** Lets a caller (the vault menu's Share… action) drive the popover too. Uncontrolled when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False for a private vault: the trigger reads "Share" (not "Invite") and opens
   *  the convert-to-team gate, not a members peek, so it must not open on a passing hover. */
  hasTeam?: boolean;
}) {
  const { t } = useTranslation();
  const openMembersInvite = useUIStore((s) => s.openMembersInvite);
  const [invHovered, setInvHovered] = useState(false);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (value: boolean | ((o: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(open) : value;
    onOpenChange?.(next);
    setUncontrolledOpen(next);
  };
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const visible = members.slice(0, MAX_STACK);
  const overflow = members.length - MAX_STACK;

  // The popover is portalled out of the header, so moving the pointer into it
  // fires the stack's mouseleave. Defer the close so the popover's own
  // mouseenter can cancel it.
  const openPopover = () => {
    if (!hasTeam) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(true);
  };
  const closePopover = () => {
    if (!hasTeam) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const toggleOpen = () => setOpen((o) => !o);
  const handleTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleOpen();
    }
  };

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 shrink-0"
      onMouseLeave={closePopover}
    >
      {/* Stack */}
      {members.length > 0 && (
        <button
          type="button"
          onClick={toggleOpen}
          onKeyDown={handleTriggerKeyDown}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("layout.vaultHeader.members")}
          className="relative flex items-center rounded-full"
          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          {visible.map((m, i) => (
            <div
              key={m.user_id}
              title={m.handle}
              style={{
                marginLeft: i === 0 ? 0 : -9,
                zIndex: MAX_STACK - i,
                borderRadius: "50%",
                border: m.is_online
                  ? "2px solid var(--t-status-connected)"
                  : "2px solid transparent",
                boxShadow: "0 0 0 1.5px var(--t-bg-chrome)",
                opacity: m.is_online ? 1 : 0.45,
                transition: "border-color 0.2s, opacity 0.2s",
              }}
            >
              <MiniAvatar name={m.handle} size={24} />
            </div>
          ))}
          <AvatarOverflow count={overflow} size={24} ringColor="var(--t-bg-chrome)" />
        </button>
      )}

      <button
        type="button"
        onClick={toggleOpen}
        onMouseEnter={() => {
          setInvHovered(true);
          openPopover();
        }}
        onMouseLeave={() => setInvHovered(false)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("members.share.title", { vault: vaultName })}
        className="flex items-center gap-1 rounded-full transition-all shrink-0"
        style={{
          height: 26,
          padding: "0 0.625rem",
          border: hasTeam ? "1px solid transparent" : `2px dashed ${invHovered ? "var(--t-accent)" : "var(--t-border)"}`,
          background: hasTeam
            ? (invHovered ? "var(--t-accent)" : "var(--t-bg-elevated)")
            : (invHovered ? "rgba(var(--t-accent-rgb, 99,102,241), 0.1)" : "transparent"),
          color: hasTeam ? (invHovered ? "var(--t-on-accent, #fff)" : "var(--t-text-secondary)") : (invHovered ? "var(--t-accent)" : "var(--t-text-dim)"),
        }}
      >
        <Icon icon="lucide:plus" width={12} />
        <span className="text-xs font-semibold">
          {hasTeam ? t("members.share.tabInvite") : t("members.share.shareVerb")}
        </span>
      </button>

      {/* Popover — portalled: the page overlay in MainPanel outranks the
          header's stacking context, so an in-flow popover paints under it. */}
      <PickerSurface
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        width={320}
        // 320 leaves the Links tab's Create button below the fold.
        maxHeight={480}
        align="right"
        gap={4}
        title={t("members.share.title", { vault: vaultName })}
        glass
      >
        <div onMouseEnter={openPopover} onMouseLeave={closePopover}>
          <VaultShareSheet vaultId={vaultId} variant="popover" onRequestFull={openMembersInvite} />
        </div>
      </PickerSurface>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(date: Date | null): string | null {
  if (!date) return null;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return i18n.t("layout.vaultHeader.relativeTime.justNow");
  if (diffMin < 60) return i18n.t("layout.vaultHeader.relativeTime.minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return i18n.t("layout.vaultHeader.relativeTime.hoursAgo", { count: diffHr });
  return i18n.t("layout.vaultHeader.relativeTime.daysAgo", { count: Math.floor(diffHr / 24) });
}

export default function VaultHeader() {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const { teams, membersByTeam, loadMembers } = useTeamStore();

  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);

  const { accountMode } = useSubscriptionStore();

  // Use the first selected vault as the "active" vault.
  // For non-owner team members there is no local vault — the sidebar sets a
  // team ID directly, so fall back to looking up in `teams`.
  const activeVaultId = selectedVaultIds[0] ?? null;
  const vault = vaults.find((v) => v.id === activeVaultId) ?? null;
  const standaloneTeam = !vault && activeVaultId
    ? (teams.find((t) => t.id === activeVaultId) ?? null)
    : null;
  const team = vault?.teamId
    ? (teams.find((t) => t.id === vault.teamId) ?? null)
    : standaloneTeam;
  const members = team ? (membersByTeam[team.id] ?? null) : null;

  const contentVaultId = team?.id ?? activeVaultId ?? "personal";
  const counts = useVaultContents(contentVaultId);

  useEffect(() => {
    if (team && !membersByTeam[team.id]) {
      loadMembers(team.id).catch(() => {});
    }
  }, [team?.id]);

  const target: VaultAdminTarget | null = vault
    ? { kind: "local", vaultId: vault.id, teamId: vault.teamId ?? null, name: vault.name }
    : standaloneTeam
      ? { kind: "cloud", vaultId: null, teamId: standaloneTeam.id, name: standaloneTeam.name }
      : null;
  const admin = useVaultAdmin(target);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const vaultSharePending = useUIStore((s) => s.vaultSharePending);
  const clearVaultSharePending = useUIStore((s) => s.clearVaultSharePending);
  useEffect(() => {
    // Mirrors the rail's Share… action: it switches to this vault and sets this
    // flag, since the rail hosts no share sheet of its own.
    if (vaultSharePending && target) {
      admin.setShareOpen(true);
      clearVaultSharePending();
    }
    // `!!target`, not `target`: target is a fresh object literal every render, so
    // depending on it directly would re-run this effect on every render instead
    // of only when the vault menu's Share… action actually just fired.
  }, [vaultSharePending, !!target, admin.setShareOpen, clearVaultSharePending]);

  if (!vault && !standaloneTeam) return null;

  const displayName = vault ? vault.name : (standaloneTeam!.name);
  const initial = displayName.trim().charAt(0).toUpperCase();
  const isE2EE = accountMode === "local";
  const lastSync = relativeTime(syncState.lastSync);
  const showSync = syncState.cloudActive && lastSync;

  return (
    <div
      className="grid grid-cols-[1fr_auto_1fr] items-center shrink-0 px-5 gap-5"
      style={{
        height: "4.25rem",
        background: "transparent",
      }}
    >
      {/* Left zone: icon + vault info */}
      <div className="flex items-center gap-4 min-w-0">
        <div
          className="flex items-center justify-center shrink-0 rounded-xl text-base font-bold text-white"
          style={{
            width: 40,
            height: 40,
            background: "linear-gradient(145deg, color-mix(in srgb, var(--t-accent) 78%, #ffffff 22%) 0%, var(--t-accent) 55%, color-mix(in srgb, var(--t-accent) 82%, #000000 18%) 100%)",
            boxShadow: "var(--t-ring), 0 6px 14px -6px color-mix(in srgb, var(--t-accent) 55%, transparent), var(--t-highlight)",
          }}
        >
          {initial}
        </div>

        <div className="flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={admin.pos !== null}
              aria-label={t("layout.vaultMenu.openMenu")}
              onClick={() => triggerRef.current && admin.openAtElement(triggerRef.current)}
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 -ml-1.5 transition-colors"
              style={{ background: admin.pos !== null ? "var(--t-bg-elevated)" : "transparent", border: "none", cursor: "pointer" }}
            >
              <span className="text-base font-semibold truncate" style={{ color: "var(--t-text-primary)" }}>
                {displayName}
              </span>
              <Icon icon="lucide:chevron-down" width={12} style={{ color: "var(--t-text-dim)" }} />
            </button>
            {team && <Badge label={t("layout.vaultHeader.teamBadge")} />}
            {members !== null && (
              <Badge label={t("layout.vaultHeader.memberCount", { count: members.length })} accent />
            )}
            {showSync && (
              <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>{t("layout.vaultHeader.lastSync", { time: lastSync })}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs mt-0.5 flex-wrap" style={{ color: "var(--t-text-dim)" }}>
            {isE2EE && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--t-status-connected)" }} />
                {t("layout.vaultHeader.e2ee")}
              </span>
            )}
            <ContentCounts counts={counts} />
          </div>
        </div>
      </div>

      {/* Center zone: command palette */}
      <button
        onClick={() => setOmniOpen(true)}
        className="flex items-center gap-2 px-3.5 h-9 rounded-lg transition-colors justify-self-center w-[clamp(20rem,30vw,27.5rem)]"
        style={{
          background: "var(--t-bg-chrome-field)",
          color: "var(--t-text-secondary)",
          border: "1px solid var(--t-chrome-field-border)",
          boxShadow: "inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-chrome-field-hover)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-chrome-field)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-chrome-field-border)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent), 0 0 0 3px color-mix(in srgb, var(--t-accent) 25%, transparent)";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-chrome-field-border)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent)";
        }}
      >
        <Icon icon="lucide:search" width={14} className="shrink-0" />
        <span className="text-sm flex-1 text-left">{t("layout.vaultHeader.jumpTo")}</span>
        <kbd
          className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md"
          style={{
            background: "color-mix(in srgb, #000000 22%, transparent)",
            color: "var(--t-text-secondary)",
            border: "1px solid color-mix(in srgb, #ffffff 7%, transparent)",
          }}
        >
          <span>⌘</span>
          <span>K</span>
        </kbd>
      </button>

      {/* Right zone: online members */}
      <div className="flex items-center justify-end min-w-0">
        {/* Shown for a private vault too: the sheet's `!teamId` branch is the
            conversion consent gate. */}
        {activeVaultId && (accountMode === "server" || team) && (
          <MembersStack
            members={members ?? []}
            vaultId={activeVaultId}
            vaultName={vault?.name ?? team?.name ?? ""}
            open={admin.shareOpen}
            onOpenChange={admin.setShareOpen}
            hasTeam={!!team}
          />
        )}
      </div>

      <VaultAdminSurface admin={admin} target={target} />
    </div>
  );
}

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
      style={{
        background: accent
          ? "color-mix(in srgb, var(--t-accent) 15%, transparent)"
          : "var(--t-bg-elevated)",
        color: accent ? "var(--t-accent)" : "var(--t-text-secondary)",
        border: accent
          ? "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)"
          : "1px solid var(--t-border)",
      }}
    >
      {label}
    </span>
  );
}
