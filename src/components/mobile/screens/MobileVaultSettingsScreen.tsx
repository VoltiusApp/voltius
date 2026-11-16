import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { APPBAR_TONAL } from "../MobileHeader";
import { useCollapsingHeader } from "../useCollapsingHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useAutosave } from "@/hooks/useAutosave";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { AvatarOverflow, MiniAvatar } from "@/components/shared/AvatarStack";
import { StatusDot } from "@/components/shared/StatusDot";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { formatRelative } from "@/utils/localeFormat";
import { memberAvatarLabel } from "@/services/memberLabel";
import type { TeamMember } from "@/services/teamService";
import { haptic } from "@/lib/haptics";
import { resolveVaultAdminTarget, type VaultAdminTarget } from "@/components/vault-admin/vaultAdminTarget";
import { useVaultAdminState } from "@/components/vault-admin/useVaultAdmin";
import { useVaultAdminActions } from "@/components/vault-admin/useVaultAdminActions";
import { VaultAdminDialogs, type VaultDialog } from "@/components/vault-admin/VaultAdminDialogs";
import { VAULT_ACTION_ICONS, vaultMenuActions } from "@/components/vault-admin/vaultMenuItems";
import { VaultShareSheet } from "@/components/vault-share/VaultShareSheet";
import { TeamRolesPanel } from "@/components/members/panels/RolesPanel";
import { SecurityPolicyPanel } from "@/components/members/panels/SecurityPolicyPanel";
import type { VaultSettingsPage } from "@/stores/mobileNavCore";
import { vaultSettingsSections, type VaultSettingsRow } from "./vaultSettingsCore";

const NO_TITLE = { current: null };
const MAX_AVATARS = 3;

/**
 * Android vault settings: the desktop vault menu (VaultHeader / rail) as an M3 page.
 * `page` unset = the list; otherwise one of its sub-pages, each its own stack entry so
 * Back and predictive back walk them like any other pushed page.
 */
export default function MobileVaultSettingsScreen({ vaultId, page }: { vaultId: string; page?: VaultSettingsPage }) {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const pop = useMobileNavStore((s) => s.pop);
  const target = resolveVaultAdminTarget(vaultId, vaults, teams);

  const appbarRef = useRef<HTMLDivElement>(null);
  const largeTitleRef = useRef<HTMLDivElement>(null);
  const scroll = useCollapsingHeader(appbarRef, page ? NO_TITLE : largeTitleRef);

  const title = page ? t(`mobile.vaultSettings.rows.${page}`) : (target?.name ?? t("mobile.vaultSettings.title"));

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)" data-mobile-vault-settings={page ?? "root"}>
      <div ref={appbarRef} className="group/appbar flex-1 min-h-0 flex flex-col">
        {/* M3 top app bar: ← + title (the root's large title folds into it). */}
        <header data-mobile-appbar className={`shrink-0 h-16 flex items-center gap-1 pl-1 pr-4 bg-(--t-bg-base) ${APPBAR_TONAL}`}>
          <button data-mobile-back onClick={pop} aria-label={t("mobile.sheets.shared.back")} className="vt-icon-btn text-(--t-text-primary)">
            <Icon icon="lucide:arrow-left" width={24} />
          </button>
          <span className="flex-1 min-w-0 flex flex-col" style={page ? undefined : { opacity: "clamp(0, calc((var(--vt-fold, 0) - 0.5) * 2), 1)" }}>
            <span className="truncate text-xl font-medium text-(--t-text-primary)">{title}</span>
            {page && target && <span className="truncate text-xs text-(--t-text-dim)">{target.name}</span>}
          </span>
        </header>
        <div
          className="flex-1 overflow-y-auto scrollbar-none"
          style={{ paddingBottom: "var(--vt-safe-bottom)" }}
          onScroll={scroll.onScroll}
          data-mobile-vault-settings-body
        >
          {!target ? (
            <p data-vault-settings-gone className="px-4 py-8 text-center text-sm text-(--t-text-dim)">{t("mobile.vaultSettings.gone")}</p>
          ) : page ? (
            <VaultSettingsSubPage vaultId={vaultId} target={target} page={page} onLeave={pop} />
          ) : (
            <VaultSettingsList vaultId={vaultId} target={target} titleRef={largeTitleRef} />
          )}
        </div>
      </div>
    </div>
  );
}

function VaultSettingsSubPage({ vaultId, target, page, onLeave }: {
  vaultId: string; target: VaultAdminTarget; page: VaultSettingsPage; onLeave: () => void;
}) {
  const teamId = target.teamId;
  // These panels were laid out for a 320 px desktop side panel: every button inside
  // gets a 48 dp hit area on the phone (C7).
  return (
    <div data-vault-settings-page={page} data-vt-hit-scope className={page === "share" || page === "members" ? "" : "p-4"}>
      {(page === "share" || page === "members") && (
        <VaultShareSheet vaultId={vaultId} variant="page" initialTab={page === "members" ? "people" : "invite"} onRequestFull={onLeave} />
      )}
      {page === "roles" && teamId && <TeamRolesPanel teamId={teamId} />}
      {page === "security" && teamId && <SecurityPolicyPanel teamId={teamId} />}
    </div>
  );
}

function VaultSettingsList({ vaultId, target, titleRef }: {
  vaultId: string; target: VaultAdminTarget; titleRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const push = useMobileNavStore((s) => s.push);
  const pop = useMobileNavStore((s) => s.pop);
  const { caps, memberCount, canShare } = useVaultAdminState(target);
  const sections = vaultSettingsSections(vaultMenuActions({ caps, canShare }));
  const [dialog, setDialog] = useState<VaultDialog>(null);
  // The dialogs are desktop modals: the system Back closes them, not the page under them.
  useBackInterceptor(dialog !== null, () => setDialog(null));

  const teamId = target.teamId;
  const members = useTeamStore((s) => (teamId ? s.membersByTeam[teamId] : undefined));
  useEffect(() => {
    if (!teamId) return;
    // Members feed the avatars and the count, roles the capabilities (managers vs members).
    const { membersByTeam, rolesByTeam, loadMembers, loadRoles } = useTeamStore.getState();
    if (!membersByTeam[teamId]) loadMembers(teamId).catch(() => {});
    if (!rolesByTeam[teamId]) loadRoles(teamId).catch(() => {});
  }, [teamId]);

  const summary = (row: VaultSettingsRow): string | null => {
    switch (row.id) {
      case "members": return memberCount !== null ? t("mobile.vaultSettings.summaries.members", { count: memberCount }) : null;
      case "delete": return t(teamId ? "mobile.vaultSettings.summaries.deleteTeam" : "mobile.vaultSettings.summaries.delete");
      case "name": return null;
      default: return t(`mobile.vaultSettings.summaries.${row.id}`);
    }
  };

  const tap = (row: VaultSettingsRow) => {
    if (row.id === "makePrivate" || row.id === "delete" || row.id === "leave") setDialog(row.id);
    else if (row.id !== "name") push({ kind: "vault-settings", vaultId, page: row.id });
  };

  return (
    <div className="pb-4">
      <div ref={titleRef} data-mobile-large-title className="px-4 pt-1 pb-4" style={{ opacity: "calc(1 - var(--vt-fold, 0) * 0.6)" }}>
        <h1 className="text-3xl font-medium text-(--t-text-primary) truncate">{target.name}</h1>
        <VaultStatus vaultId={teamId ?? target.vaultId ?? vaultId} isTeam={caps.isTeam} members={members ?? []} memberCount={memberCount} />
      </div>

      {sections.map((section) => (
        <section key={section.id} data-vault-settings-section={section.id} className="mb-2">
          <h2 className="px-4 pt-4 pb-2 text-sm font-medium" style={{ color: section.id === "danger" ? "var(--t-danger, #e5484d)" : "var(--t-accent)" }}>
            {t(`mobile.vaultSettings.sections.${section.id}`)}
          </h2>
          {section.rows.map((row) =>
            row.id === "name" ? (
              <VaultNameRow key="name" target={target} editable={row.editable} />
            ) : (
              <SettingsRow
                key={row.id}
                id={row.id}
                icon={VAULT_ACTION_ICONS[row.id]}
                label={t(`mobile.vaultSettings.rows.${row.id}`)}
                summary={summary(row)}
                danger={section.id === "danger"}
                chevron={section.id !== "danger"}
                onTap={() => tap(row)}
              />
            ),
          )}
        </section>
      ))}

      <VaultAdminDialogs
        target={target}
        dialog={dialog}
        onClose={() => setDialog(null)}
        // The confirming tap of a destructive verb (B6).
        onConfirmed={() => haptic("confirm")}
        // Deleted or left: the vault this page is about is gone.
        onDone={() => { if (dialog === "delete" || dialog === "leave") pop(); }}
      />
    </div>
  );
}

function SettingsRow({ id, icon, label, summary, danger, chevron, onTap }: {
  id: string; icon: string; label: string; summary: string | null; danger?: boolean; chevron?: boolean; onTap: () => void;
}) {
  return (
    <button
      data-vault-settings-row={id}
      onClick={onTap}
      className={`w-full flex items-center gap-4 pl-4 pr-3 py-2 text-left ${summary ? "min-h-[72px]" : "min-h-14"}`}
    >
      <Icon icon={icon} width={24} className="shrink-0" style={{ color: danger ? "var(--t-danger, #e5484d)" : "var(--t-text-dim)" }} />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-base truncate" style={{ color: danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}>{label}</span>
        {summary && <span className="text-sm text-(--t-text-dim) line-clamp-2">{summary}</span>}
      </span>
      {chevron && <Icon icon="lucide:chevron-right" width={20} className="shrink-0 text-(--t-text-dim)" />}
    </button>
  );
}

/** The vault name, renamed in place: saved like the C5 edit forms (debounced, flushed on blur and on leaving). */
function VaultNameRow({ target, editable }: { target: VaultAdminTarget; editable: boolean }) {
  const { t } = useTranslation();
  const { rename } = useVaultAdminActions(target);
  const [draft, setDraft] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const { schedule, markDirty, flush } = useAutosave({
    onSave: () => rename(draft),
    canSave: () => draft.trim().length > 0,
    flushOnUnmount: true,
  });
  useEffect(() => schedule(), [draft]);
  // Renamed elsewhere (another device, the desktop): follow it unless the user is typing.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(target.name);
  }, [target.name]);

  return (
    <label data-vault-settings-row="name" className="block px-4 py-2">
      <span className="block mb-1 text-xs font-medium text-(--t-text-dim)">{t("mobile.vaultSettings.rows.name")}</span>
      {editable ? (
        <input
          ref={inputRef}
          data-vault-settings-name
          value={draft}
          enterKeyHint="done"
          onChange={(e) => { markDirty(); setDraft(e.target.value); }}
          onBlur={() => { flush(); if (!draft.trim()) setDraft(target.name); }}
          onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.blur(); }}
          className="w-full h-14 px-4 rounded-lg bg-transparent text-base text-(--t-text-primary) outline-none focus:border-(--t-accent)"
          style={{ border: "1px solid color-mix(in srgb, var(--t-text-primary) 30%, transparent)" }}
        />
      ) : (
        <span data-vault-settings-name-readonly className="flex items-center h-14 text-base text-(--t-text-primary) truncate">{target.name}</span>
      )}
      {editable && !draft.trim() && (
        <span data-field-error className="block mt-1 text-xs" style={{ color: "var(--t-danger, #e5484d)" }}>{t("mobile.vaultSettings.nameRequired")}</span>
      )}
      {!editable && <span className="block text-xs text-(--t-text-dim)">{t("mobile.vaultSettings.nameReadOnly")}</span>}
    </label>
  );
}

/** E2EE, item counts, last sync and who is in it: the desktop vault header's status line. */
function VaultStatus({ vaultId, isTeam, members, memberCount }: {
  vaultId: string;
  isTeam: boolean;
  members: TeamMember[];
  memberCount: number | null;
}) {
  const { t } = useTranslation();
  const counts = useVaultContents(vaultId);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const [sync, setSync] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSync(getSyncState())), []);
  const lastSync = sync.cloudActive && sync.lastSync ? formatRelative(sync.lastSync) : null;
  const items: ReactNode[] = [];
  // Same rule as the desktop header: a local account's vaults are end-to-end encrypted.
  if (accountMode === "local") {
    items.push(
      <span key="e2ee" className="flex items-center gap-1"><StatusDot tone="connected" size="sm" />{t("layout.vaultHeader.e2ee")}</span>,
    );
  }
  items.push(<span key="kind">{t(isTeam ? "mobile.vaultSettings.kindTeam" : "mobile.vaultSettings.kindPrivate")}</span>);
  return (
    <div data-vault-settings-status className="mt-2 flex flex-col gap-2 text-sm text-(--t-text-dim)">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{items}</div>
      <ContentCounts counts={counts} className="flex items-center gap-3" />
      {lastSync && <span data-vault-settings-sync>{t("layout.vaultHeader.lastSync", { time: lastSync })}</span>}
      {isTeam && members.length > 0 && (
        <span data-vault-settings-avatars className="flex items-center gap-2">
          <span className="flex items-center">
            {members.slice(0, MAX_AVATARS).map((m, i) => (
              <span key={m.user_id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: "50%", boxShadow: "0 0 0 2px var(--t-bg-base)" }}>
                <MiniAvatar name={memberAvatarLabel(m)} size={24} />
              </span>
            ))}
            <AvatarOverflow count={members.length - MAX_AVATARS} size={24} ringColor="var(--t-bg-base)" />
          </span>
          {memberCount !== null && <span>{t("mobile.vaultSettings.summaries.members", { count: memberCount })}</span>}
        </span>
      )}
    </div>
  );
}
