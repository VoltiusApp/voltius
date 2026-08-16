import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useTeamStore } from "@/stores/teamStore";
import {
  allTeammates,
  groupPeople,
  memberHasLiveAccess,
  seatUsage,
  type InviteSession,
  type InviteTarget,
  type ShareTier,
  type Teammate,
} from "@/services/teamSharing";
import { useUserSearch } from "@/hooks/useUserSearch";
import { useRecentPeopleStore } from "@/stores/recentPeopleStore";
import { ParticipantsRatioNotice } from "./ParticipantsRatioNotice";
import { ContextMenu } from "@/components/shared/ContextMenu";

interface PeopleTabProps {
  session: InviteSession;
  /**
   * Owned by ShareMenu, not here: the first invite on an unshared terminal creates
   * the session, which flips the setup view to the active view and remounts this
   * component. Local state would be lost exactly when the cap most needs it.
   */
  invitedThisSession: ReadonlySet<string>;
  guestCap: number;
  tier: ShareTier;
  onUpgrade: () => void;
  onInvite: (target: InviteTarget) => Promise<void>;
  /** Withdraws a standing invite. Absent before the session exists, when no row can be invited yet. */
  onUninvite?: (userId: string) => Promise<void>;
}

/** A normalized row: whichever group it came from, the row itself doesn't care. */
interface RowEntry {
  target: InviteTarget;
  /** Teammate group memberships, for `memberHasAccess`. Empty for Recent/stranger rows. */
  teamIds: string[];
  isStranger: boolean;
  /** Only teammates carry live presence; undefined omits the dot entirely. */
  isOnline?: boolean;
  /** Only Recent rows: the roster and search hits aren't ours to delete. */
  canForget?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * Row controls stay out of the way until the row is aimed at. Coarse pointers
 * have no hover to reveal them with, so there they're simply always visible.
 */
const REVEAL =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 px-2 py-1.5 rounded-sm text-[11px]"
      style={{
        background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
        color: "var(--t-status-error)",
        border: "1px solid color-mix(in srgb, var(--t-status-error) 25%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

function PersonRow({
  entry,
  hasAccess,
  inFlight,
  invited,
  capBlocked,
  onInvite,
  onUninvite,
  onForget,
  t,
}: {
  entry: RowEntry;
  hasAccess: boolean;
  inFlight: boolean;
  invited: boolean;
  capBlocked: boolean;
  onInvite: () => void;
  /** Offered only on a standing invite: the seat it holds is the one A6 exists to free. */
  onUninvite?: () => void;
  /** Drops the person from Recent. Absent on rows that aren't ours to delete. */
  onForget?: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const { target, isStranger, isOnline, onContextMenu } = entry;
  const actionable = !hasAccess && !inFlight && !invited && !capBlocked;
  return (
    <div className={`group flex items-center gap-1 rounded-md transition-colors ${actionable ? "hover:bg-(--t-bg-elevated)" : ""}`}>
      <button
        className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors focus-visible:outline-1 focus-visible:outline-(--t-accent) ${actionable ? "cursor-pointer" : "cursor-default"}`}
        style={{ color: "var(--t-text-primary)", background: "transparent" }}
        disabled={!actionable}
        onClick={onInvite}
        onContextMenu={onContextMenu}
      >
        {isOnline !== undefined && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: isOnline ? "var(--t-status-success)" : "var(--t-text-dim)" }}
          />
        )}
        <span className="flex-1 min-w-0 text-left">
          <span className="text-xs truncate block">{target.handle ? `@${target.handle}` : "?"}</span>
        </span>
        {isStranger && (
          <span
            className="text-[10px] px-1 py-0.5 rounded-sm shrink-0"
            style={{ color: "var(--t-text-dim)", border: "1px solid var(--t-border)" }}
          >
            {t("terminal.share.notInYourTeams")}
          </span>
        )}
        {hasAccess ? (
          <span className="text-[10px] shrink-0" style={{ color: "var(--t-text-dim)" }}>
            {t("terminal.share.inviteHasAccess")}
          </span>
        ) : inFlight ? (
          <Icon icon="lucide:loader-circle" width={12} className="animate-spin" style={{ color: "var(--t-text-dim)" }} />
        ) : invited ? (
          <span className="text-[10px] shrink-0" style={{ color: "var(--t-accent)" }}>
            {t("terminal.share.inviteSent")}
          </span>
        ) : capBlocked ? (
          <span className="text-[10px] shrink-0" style={{ color: "var(--t-text-dim)" }}>
            {t("terminal.share.inviteCapReached")}
          </span>
        ) : (
          // Names the action rather than only hinting the row is live: an
          // untouched row is otherwise indistinguishable from static text.
          <Icon icon="lucide:user-plus" width={12} className={`shrink-0 ${REVEAL}`} style={{ color: "var(--t-text-dim)" }} />
        )}
      </button>
      {invited && onUninvite && (
        <button
          className="text-[10px] px-1.5 py-1 rounded-md shrink-0 transition-colors cursor-pointer"
          style={{ color: "var(--t-text-dim)" }}
          title={t("terminal.share.withdrawInvite")}
          onClick={onUninvite}
        >
          {t("terminal.share.withdrawInvite")}
        </button>
      )}
      {onForget && (
        <button
          // Colour lives in classes, not `style`: an inline colour outranks the
          // hover variant and the red-on-hover never lands.
          className={`p-1 mr-1 rounded-md shrink-0 cursor-pointer text-(--t-text-dim) hover:text-(--t-status-error) ${REVEAL}`}
          title={t("terminal.share.forgetPerson")}
          aria-label={t("terminal.share.forgetPerson")}
          onClick={onForget}
        >
          <Icon icon="lucide:x" width={12} />
        </button>
      )}
    </div>
  );
}

export function PeopleTab({ session, invitedThisSession, guestCap, tier, onUpgrade, onInvite, onUninvite }: PeopleTabProps) {
  const { t } = useTranslation();
  const teams = useTeamStore((s) => s.teams);
  const recent = useRecentPeopleStore((s) => s.recent);
  const forget = useRecentPeopleStore((s) => s.forget);
  const search = useUserSearch();

  const [teammates, setTeammates] = useState<Teammate[]>([]);
  // Distinct from "loaded, zero teammates": a fetch failure must not read as an
  // empty team, which is exactly the failure mode a teaching empty state hides.
  const [teammatesLoadFailed, setTeammatesLoadFailed] = useState(false);
  const [inviting, setInviting] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ userId: string; pos: { x: number; y: number } } | null>(null);

  // Reload whenever the team list changes — ShareMenu kicks off `loadTeams()` fire-and-forget
  // on open, so on a fresh install/first sign-in the roster isn't populated yet at mount.
  useEffect(() => {
    let cancelled = false;
    allTeammates()
      .then((m) => { if (!cancelled) { setTeammates(m); setTeammatesLoadFailed(false); } })
      .catch(() => { if (!cancelled) { setTeammates([]); setTeammatesLoadFailed(true); } });
    return () => { cancelled = true; };
  }, [teams]);

  const { committedSeats, atCap } = seatUsage(session, invitedThisSession, guestCap);

  const setInFlight = (userId: string, active: boolean) =>
    setInviting((prev) => {
      const next = new Set(prev);
      if (active) next.add(userId); else next.delete(userId);
      return next;
    });

  const handleInvite = async (target: InviteTarget) => {
    setError(null);
    setInFlight(target.user_id, true);
    try {
      await onInvite(target);
      // Recent is written on a successful invite — the signal is "I chose this person",
      // not that they later accepted.
      useRecentPeopleStore.getState().remember({
        user_id: target.user_id,
        handle: target.handle,
        last_invited_at: new Date().toISOString(),
      });
    } catch {
      setError(t("terminal.share.inviteFailed", { name: target.handle }));
    } finally {
      setInFlight(target.user_id, false);
    }
  };

  // A6: a standing invite holds a guest seat until the session ends, so a Pro
  // host at cap 1 whose invitee never arrives has no way forward without this.
  const handleUninvite = async (userId: string) => {
    if (!onUninvite) return;
    setError(null);
    setInFlight(userId, true);
    try {
      await onUninvite(userId);
    } catch {
      setError(t("terminal.share.uninviteFailed"));
    } finally {
      setInFlight(userId, false);
    }
  };

  const groups = groupPeople({ query: search.query, teammates, recent, results: search.results });

  const recentEntries: RowEntry[] = groups.recent.map((p) => {
    // Recent wins the dedupe, so a teammate listed here is dropped from the
    // teammate group entirely — and with it their `teamIds`, which is what
    // `memberHasAccess` tests against the session's vaults first. Without this
    // merge the row renders as invitable, and inviting spends a guest seat on
    // someone who already has access.
    const teammate = teammates.find((m) => m.user_id === p.user_id);
    return {
      target: {
        user_id: p.user_id,
        handle: p.handle,
        team_id: teammate?.teamIds[0],
      },
      teamIds: teammate?.teamIds ?? [],
      isStranger: false,
      canForget: true,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        setMenu({ userId: p.user_id, pos: { x: e.clientX, y: e.clientY } });
      },
    };
  });
  const teammateEntries: RowEntry[] = groups.teammates.map((m) => ({
    // An older server (no migration 035) omits `handle`; never render a bare "@".
    target: { user_id: m.user_id, handle: m.handle ?? "", team_id: m.teamIds[0] },
    teamIds: m.teamIds,
    isStranger: false,
    isOnline: !!m.is_online,
  }));
  const strangerEntries: RowEntry[] = groups.strangers.map((s) => ({
    target: { user_id: s.user_id, handle: s.handle },
    teamIds: [],
    isStranger: true,
  }));

  const renderRow = (entry: RowEntry) => {
    // "Has access" is being in the room — a shared vault or live participation.
    // A grant nobody has accepted yet is "Invited", the state a host may still
    // withdraw. It still counts against the cap (`memberHasAccess`), which is
    // why the two questions are asked separately.
    const hasAccess = memberHasLiveAccess({ user_id: entry.target.user_id, teamIds: entry.teamIds }, session);
    const inFlight = inviting.has(entry.target.user_id);
    const invited =
      !hasAccess &&
      (invitedThisSession.has(entry.target.user_id) || session.invitedIds.includes(entry.target.user_id));
    // A row this session just invited keeps showing "Invited", not the cap notice.
    const capBlocked = atCap && !hasAccess && !invited;
    return (
      <PersonRow
        key={entry.target.user_id}
        entry={entry}
        hasAccess={hasAccess}
        inFlight={inFlight}
        invited={invited}
        capBlocked={capBlocked}
        onInvite={() => handleInvite(entry.target)}
        onUninvite={onUninvite ? () => handleUninvite(entry.target.user_id) : undefined}
        onForget={entry.canForget ? () => forget(entry.target.user_id) : undefined}
        t={t}
      />
    );
  };

  const searchedEmpty =
    search.query.trim().length > 0 && recentEntries.length === 0 && teammateEntries.length === 0 && strangerEntries.length === 0;

  return (
    <div className="px-3 pb-3">
      <div
        className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border"
        style={{ background: "var(--t-bg-input)", borderColor: "var(--t-border)" }}
      >
        <Icon icon="lucide:search" width={13} className="shrink-0" style={{ color: "var(--t-text-dim)" }} />
        <input
          type="text"
          placeholder={t("terminal.share.peopleSearchPlaceholder")}
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          className="flex-1 bg-transparent outline-hidden text-sm"
          style={{ color: "var(--t-text-primary)" }}
        />
      </div>

      <ParticipantsRatioNotice count={committedSeats} guestCap={guestCap} atCap={atCap} countsInvites tier={tier} onUpgrade={onUpgrade} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {teammatesLoadFailed && <ErrorBanner>{t("terminal.share.inviteLoadFailed")}</ErrorBanner>}

      {searchedEmpty ? (
        <div className="text-xs text-center py-3" style={{ color: "var(--t-text-dim)" }}>
          <p>{t("terminal.share.peopleNoMatch", { query: search.query.trim() })}</p>
          <p className="mt-1">{t("terminal.share.peopleFindRule")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase mb-0.5 px-2" style={{ color: "var(--t-text-dim)" }}>
              {t("terminal.share.recentLabel")}
            </p>
            {recentEntries.length > 0 ? (
              <div className="flex flex-col gap-0.5">{recentEntries.map(renderRow)}</div>
            ) : (
              <p className="text-xs px-2 py-1" style={{ color: "var(--t-text-dim)" }}>
                {t("terminal.share.recentEmpty")}
              </p>
            )}
          </div>

          {teammateEntries.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase mb-0.5 px-2" style={{ color: "var(--t-text-dim)" }}>
                {t("terminal.share.yourTeamsLabel")}
              </p>
              <div className="flex flex-col gap-0.5">{teammateEntries.map(renderRow)}</div>
            </div>
          )}

          {strangerEntries.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase mb-0.5 px-2" style={{ color: "var(--t-text-dim)" }}>
                {t("terminal.share.elsewhereLabel")}
              </p>
              <div className="flex flex-col gap-0.5">{strangerEntries.map(renderRow)}</div>
            </div>
          )}
        </div>
      )}

      {menu && (
        <ContextMenu
          pos={menu.pos}
          onClose={() => setMenu(null)}
          items={[{ label: t("terminal.share.forgetPerson"), danger: true, onClick: () => forget(menu.userId) }]}
        />
      )}
    </div>
  );
}
