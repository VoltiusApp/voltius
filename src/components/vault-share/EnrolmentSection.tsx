import { useCallback, useEffect, useState } from "react";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "@iconify/react";
import { ChipInput } from "@/components/shared/ChipInput";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { BusinessLockLine } from "@/components/shared/BusinessLockBanner";
import { Toggle } from "@/components/shared/Toggle";
import { roleChipColors, roleLabel } from "@/components/members/roleChips";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { enrollmentApi, EnrollmentError, type CreatedEnrollmentToken, type EnrollmentTokenInfo } from "@/services/enrollment/enrollmentApi";
import { buildEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { userFacingReason } from "@/services/errorReason";
import { getServerUrl } from "@/services/authTokens";
import { useServerEmailDelivery } from "@/services/serverCapabilities";
import { runTeamAction } from "@/services/teamActionFeedback";
import { useTeamStore, type TeamRole } from "@/stores/teamStore";
import { writeClipboard } from "@/utils/clipboard";
import { formatDateTime, formatRelative } from "@/utils/localeFormat";
import { ChoiceChip } from "./ChoiceChip";

const LABEL = "text-[10px] uppercase tracking-wider text-(--t-text-secondary)";
const ACCENT_BTN = { background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" };
const EXPIRY_PRESETS = [
  { key: "never", days: null },
  { key: "day30", days: 30 },
  { key: "day90", days: 90 },
  { key: "year1", days: 365 },
] as const;
const DAY_MS = 24 * 3600_000;
const SHORT_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

const normaliseDomain = (text: string) => text.trim().replace(/^@+/, "").toLowerCase();

function enrollmentErrorMessage(t: TFunction, e: Error): string {
  if (e instanceof EnrollmentError) {
    if (e.code === "ENROLLMENT_NEEDS_GUARD") return t("members.enrollment.error.needsGuard");
    if (e.code === "ENROLLMENT_NEEDS_APPROVAL") return t("members.enrollment.error.needsApproval");
    if (e.code === "ENROLLMENT_UNAVAILABLE" || (e.code === null && e.status === 402)) return t("members.enrollment.error.unavailable");
  }
  return userFacingReason(e);
}

const isPlanRefusal = (e: unknown) =>
  e instanceof EnrollmentError && (e.code === "ENROLLMENT_UNAVAILABLE" || (e.code === null && e.status === 402));

interface Settings {
  role: string;
  domains: string[];
  approve: boolean;
  expiresAt: string | null;
}

interface Props {
  teamId: string;
  roles: TeamRole[];
}

export function EnrolmentSection({ teamId, roles }: Props) {
  const { t } = useTranslation();
  const { locked } = useBusinessLock(teamId);
  const noEmail = !useServerEmailDelivery();
  const teamName = useTeamStore((s) => s.teams.find((x) => x.id === teamId)?.name ?? "");
  const [info, setInfo] = useState<EnrollmentTokenInfo | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError("");
    enrollmentApi.getToken(teamId).then(setInfo).catch((e) => {
      setInfo(null);
      setLoadError(t("members.enrollment.loadFailed", { reason: userFacingReason(e) }));
    });
  }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load]);

  const run = async (action: () => Promise<void>, toast: "create" | "revoke") => {
    setBusy(true);
    try {
      await runTeamAction({
        pending: t(`members.enrollment.toast.${toast}.pending`),
        success: t(`members.enrollment.toast.${toast}.done`),
        error: (e) => t(`members.enrollment.toast.${toast}.failed`, { reason: enrollmentErrorMessage(t, e) }),
        run: action,
      });
    } catch (e) {
      if (isPlanRefusal(e)) void useTeamStore.getState().loadTeams();
    } finally {
      setBusy(false);
    }
  };

  const create = (s: Settings) =>
    run(async () => {
      const body = {
        role: s.role,
        allowed_domains: s.domains,
        require_approval: noEmail || s.approve,
        expires_at: s.expiresAt,
      };
      const serverUrl = await getServerUrl();
      if (!serverUrl) throw new Error(t("common.error.notConnectedToServer"));
      showCreated(await enrollmentApi.createToken(teamId, body), serverUrl);
    }, "create");

  const showCreated = (made: CreatedEnrollmentToken, serverUrl: string) => {
    const { secret, ...rest } = made;
    setFresh(buildEnrollmentToken(serverUrl, made.id, secret));
    setInfo({ ...rest, created_by_name: null, last_used_at: null, admitted_count: 0, pending_count: 0 });
    enrollmentApi.getToken(teamId).then((stored) => stored && setInfo(stored)).catch(() => {});
  };

  const rotate = async () => {
    if (!info) return;
    setConfirm(null);
    await create({
      role: info.role,
      domains: info.allowed_domains,
      approve: info.require_approval,
      expiresAt: info.expires_at && new Date(info.expires_at).getTime() > Date.now() ? info.expires_at : null,
    });
  };

  const revoke = async () => {
    setConfirm(null);
    await run(async () => {
      await enrollmentApi.revokeToken(teamId);
      setFresh(null);
      setInfo(null);
    }, "revoke");
  };

  return (
    <div data-enrolment className="flex flex-col gap-3 pt-3 border-t border-(--t-border)">
      <div className="flex items-center gap-1.5">
        <Icon icon="lucide:monitor-cog" width={14} className="text-(--t-text-dim)" />
        <span className="text-xs font-semibold text-(--t-text-primary)">{t("members.enrollment.title")}</span>
      </div>
      {loadError && (
        <p className="text-[11px]" style={{ color: "var(--t-status-error)" }}>{loadError}</p>
      )}
      {locked && <BusinessLockLine teamId={teamId} label={t("members.enrollment.lapsed")} />}
      {info === undefined ? null : info ? (
        <TokenCard info={info} fresh={fresh} locked={locked} onRotate={() => setConfirm("rotate")} onRevoke={() => setConfirm("revoke")} />
      ) : (
        !locked && <CreateForm roles={roles} teamName={teamName} noEmail={noEmail} busy={busy} onCreate={(s) => void create(s)} />
      )}
      {confirm === "rotate" && (
        <ConfirmModal
          tone="warning"
          icon="lucide:refresh-cw"
          title={t("members.enrollment.rotateTitle")}
          message={t("members.enrollment.rotateMessage")}
          confirmLabel={t("members.enrollment.rotateConfirm")}
          onConfirm={() => void rotate()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "revoke" && (
        <ConfirmModal
          title={t("members.enrollment.revokeTitle")}
          message={t("members.enrollment.revokeMessage")}
          confirmLabel={t("members.enrollment.revokeConfirm")}
          onConfirm={() => void revoke()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

interface CreateFormProps {
  roles: TeamRole[];
  teamName: string;
  noEmail: boolean;
  busy: boolean;
  onCreate: (s: Settings) => void;
}

function CreateForm({ roles, teamName, noEmail, busy, onCreate }: CreateFormProps) {
  const { t } = useTranslation();
  const [domains, setDomains] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [approve, setApprove] = useState(false);
  const [role, setRole] = useState("member");
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const approval = noEmail || approve;

  const addDomain = (text: string) => {
    const d = normaliseDomain(text);
    if (d && !domains.includes(d)) setDomains([...domains, d]);
    setInput("");
  };

  return (
    <>
      <p className="text-[11px] leading-relaxed text-(--t-text-secondary)">
        {t("members.enrollment.explainer", { team: teamName })}
      </p>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>{t("members.joinLinks.joinsAs")}</span>
        <div className="flex flex-wrap gap-1.5">
          {roles.filter((r) => r.name !== "owner").map((r) => (
            <ChoiceChip key={r.id} label={roleLabel(t, r.name)} capitalize selected={r.name === role} onClick={() => setRole(r.name)} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>{t("members.enrollment.domainsLabel")}</span>
        <ChipInput
          value={domains}
          input={input}
          onInputChange={setInput}
          onAdd={addDomain}
          onRemove={(d) => setDomains(domains.filter((x) => x !== d))}
          renderChip={(d, children) => (
            <span key={d} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-(--t-bg-elevated) text-(--t-text-primary)">
              {children}
            </span>
          )}
          removeLabel={(d) => t("members.enrollment.removeDomain", { domain: d })}
          placeholder={t("members.enrollment.domainPlaceholder")}
          keepPlaceholder
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-(--t-text-primary)">{t("members.enrollment.approve")}</span>
          <Toggle checked={approval} disabled={noEmail} onChange={setApprove} aria-label={t("members.enrollment.approve")} />
        </div>
        {noEmail && (
          <p className="flex items-start gap-1.5 text-[11px] text-(--t-text-dim)">
            <Icon icon="lucide:mail-x" width={12} className="mt-0.5 shrink-0" />
            {t("members.enrollment.noEmail")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>{t("members.enrollment.expiresLabel")}</span>
        <div className="flex flex-wrap gap-1.5">
          {EXPIRY_PRESETS.map((p) => (
            <ChoiceChip key={p.key} label={t(`members.enrollment.expiry.${p.key}`)} selected={p.days === expiryDays} onClick={() => setExpiryDays(p.days)} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onCreate({ role, domains, approve, expiresAt: expiryDays ? new Date(Date.now() + expiryDays * DAY_MS).toISOString() : null })}
          disabled={busy || (domains.length === 0 && !approval)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-50"
          style={ACCENT_BTN}
        >
          {t("members.enrollment.create")}
        </button>
      </div>
      <p className="text-[10px] text-(--t-text-dim)">{t("members.enrollment.guardHint")}</p>
    </>
  );
}

interface TokenCardProps {
  info: EnrollmentTokenInfo;
  fresh: string | null;
  locked: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}

function TokenCard({ info, fresh, locked, onRotate, onRevoke }: TokenCardProps) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(2000);
  const { color, bg } = roleChipColors(info.role);
  const created = formatDateTime(info.created_at, SHORT_DATE);
  const summary = [
    ...(info.allowed_domains.length ? [info.allowed_domains.join(", ")] : []),
    t(info.require_approval ? "members.enrollment.approvalOn" : "members.enrollment.approvalOff"),
    info.expires_at ? t("members.enrollment.expiresOn", { date: formatDateTime(info.expires_at, SHORT_DATE) }) : t("members.enrollment.neverExpires"),
  ].join(" · ");

  const copy = async () => {
    if (!fresh) return;
    await writeClipboard(fresh);
    flash();
  };

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-(--t-bg-card)">
      <div className="flex items-start gap-2">
        <span className="text-[10px] px-2 py-0.5 rounded-full capitalize shrink-0" style={{ color, background: bg }}>
          {roleLabel(t, info.role)}
        </span>
        <span className="text-[11px] text-(--t-text-secondary) flex-1 min-w-0 break-words">{summary}</span>
      </div>

      {fresh && (
        <>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={fresh}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 px-2 py-1 rounded-md bg-(--t-bg-elevated) border border-(--t-border) font-mono text-[10px] text-(--t-text-secondary) outline-none"
            />
            <button onClick={() => void copy()} className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0" style={ACCENT_BTN}>
              {copied ? t("members.joinLinks.copied") : t("members.joinLinks.copy")}
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--t-status-warning)" }}>
            <Icon icon="lucide:triangle-alert" width={12} className="shrink-0" />
            {t("members.enrollment.copyNow")}
          </p>
          <span className={`${LABEL} mt-1`}>{t("members.enrollment.example")}</span>
          <code className="block px-2 py-1.5 rounded-md bg-(--t-bg-elevated) border border-(--t-border) font-mono text-[10px] text-(--t-text-primary) break-all">
            voltius-cli enroll {fresh}
          </code>
        </>
      )}

      <div className="flex flex-col gap-0.5 text-[11px] text-(--t-text-secondary)">
        <span>
          {info.created_by_name
            ? t("members.enrollment.createdBy", { name: info.created_by_name, date: created })
            : t("members.enrollment.createdOn", { date: created })}
        </span>
        <span>
          {info.last_used_at
            ? t("members.enrollment.lastUsed", { when: formatRelative(info.last_used_at, { maxDays: 30 }) })
            : t("members.enrollment.neverUsed")}
        </span>
        <span className="text-(--t-text-primary)">
          {t("members.enrollment.counts", { joined: info.admitted_count, waiting: info.pending_count })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!locked && (
          <button
            onClick={onRotate}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-(--t-border) text-(--t-text-secondary)"
          >
            <Icon icon="lucide:refresh-cw" width={12} />
            {t("members.enrollment.rotate")}
          </button>
        )}
        <button onClick={onRevoke} className="shrink-0 px-2.5 py-1 rounded-lg text-[11px]" style={{ color: "var(--t-status-error)" }}>
          {t("members.enrollment.revoke")}
        </button>
      </div>
      {!fresh && <span className="text-[10px] text-(--t-text-dim)">{t("members.enrollment.notShownAgain")}</span>}
    </div>
  );
}
