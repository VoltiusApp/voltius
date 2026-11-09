import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { ChipInput } from "@/components/shared/ChipInput";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { CopySecretField } from "@/components/shared/CopySecretField";
import { BusinessLockLine } from "@/components/shared/BusinessLockBanner";
import { Toggle } from "@/components/shared/Toggle";
import { roleChipColors, roleLabel } from "@/components/members/roleChips";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { enrollmentApi, enrollmentRefusal, type CreatedEnrollmentToken, type EnrollmentTokenInfo } from "@/services/enrollment/enrollmentApi";
import { runEnrollmentAction } from "@/services/enrollment/enrollmentAction";
import { buildEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { userFacingReason } from "@/services/errorReason";
import { getServerUrl } from "@/services/authTokens";
import { useServerEmailDelivery } from "@/services/serverCapabilities";
import { useTeamStore, type TeamRole } from "@/stores/teamStore";
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

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const normaliseDomain = (text: string) => text.trim().toLowerCase().split("@").pop()!;

const isHostname = (domain: string) => {
  const labels = domain.split(".");
  return domain.length <= 253 && labels.length >= 2 && labels.every((l) => DOMAIN_LABEL_RE.test(l));
};

const expired = (at: string | null) => at !== null && new Date(at).getTime() <= Date.now();

function rotatedExpiry({ expires_at, created_at }: EnrollmentTokenInfo): string | null {
  if (!expires_at || !expired(expires_at)) return expires_at;
  return new Date(Date.now() + new Date(expires_at).getTime() - new Date(created_at).getTime()).toISOString();
}

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
  const [loadError, setLoadError] = useState<unknown>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    setInfo(undefined);
    setLoadError(null);
    setUnsupported(false);
    enrollmentApi.getToken(teamId).then(
      (token) => {
        if (seq === loadSeq.current) setInfo(token);
      },
      (e) => {
        if (seq !== loadSeq.current) return;
        const refusal = enrollmentRefusal(e, "lapsed");
        if (refusal === "notFound" || refusal === "invitesOff") setUnsupported(true);
        else setLoadError(e);
      },
    );
  }, [teamId]);

  useEffect(load, [load]);

  const refreshInfo = useCallback(() => {
    const seq = loadSeq.current;
    enrollmentApi.getToken(teamId).then(
      (stored) => {
        if (seq === loadSeq.current && stored) setInfo(stored);
      },
      () => {},
    );
  }, [teamId]);

  const joinRequests = useTeamStore((s) => s.joinRequestsByTeam[teamId]);
  const seenJoinRequests = useRef(joinRequests);
  useEffect(() => {
    if (seenJoinRequests.current === joinRequests) return;
    seenJoinRequests.current = joinRequests;
    refreshInfo();
  }, [joinRequests, refreshInfo]);

  const run = async (action: () => Promise<void>, toast: "create" | "rotate" | "revoke") => {
    setBusy(true);
    await runEnrollmentAction(t, { toast: `members.enrollment.toast.${toast}`, bare402: "lapsed", run: action });
    setBusy(false);
  };

  const create = (s: Settings, toast: "create" | "rotate" = "create") =>
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
    }, toast);

  const showCreated = (made: CreatedEnrollmentToken, serverUrl: string) => {
    const { secret, ...rest } = made;
    setFresh(buildEnrollmentToken(serverUrl, made.id, secret));
    setInfo({ ...rest, created_by_name: null, last_used_at: null, admitted_count: 0, pending_count: 0 });
    refreshInfo();
  };

  const rotate = async () => {
    if (!info) return;
    setConfirm(null);
    await create(
      { role: info.role, domains: info.allowed_domains, approve: info.require_approval, expiresAt: rotatedExpiry(info) },
      "rotate",
    );
  };

  const revoke = async () => {
    setConfirm(null);
    await run(async () => {
      await enrollmentApi.revokeToken(teamId);
      setFresh(null);
      setInfo(null);
    }, "revoke");
  };

  if (unsupported) return null;
  return (
    <div data-enrolment className="flex flex-col gap-3 pt-3 border-t border-(--t-border)">
      <div className="flex items-center gap-1.5">
        <Icon icon="lucide:monitor-cog" width={14} className="text-(--t-text-dim)" />
        <span className="text-xs font-semibold text-(--t-text-primary)">{t("members.enrollment.title")}</span>
      </div>
      {loadError != null && (
        <p className="flex items-center gap-2 text-[11px]" style={{ color: "var(--t-status-error)" }}>
          <span className="flex-1 min-w-0">{t("members.enrollment.loadFailed", { reason: userFacingReason(loadError) })}</span>
          <button onClick={load} className="shrink-0 underline">{t("common.action.retry")}</button>
        </p>
      )}
      <BusinessLockLine teamId={teamId} label={t("members.enrollment.lapsed")} compact />
      {info === undefined || loadError != null ? null : info ? (
        <TokenCard
          info={info}
          fresh={fresh}
          locked={locked}
          busy={busy}
          onRotate={() => setConfirm("rotate")}
          onRevoke={() => setConfirm("revoke")}
        />
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
  const [domainError, setDomainError] = useState("");
  const [approve, setApprove] = useState(false);
  const [role, setRole] = useState("member");
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const approval = noEmail || approve;

  const addDomain = (text: string) => {
    const d = normaliseDomain(text);
    if (!isHostname(d)) {
      setDomainError(t("members.enrollment.invalidDomain", { domain: text.trim() }));
      return;
    }
    if (!domains.includes(d)) setDomains([...domains, d]);
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
          onInputChange={(text) => {
            setInput(text);
            setDomainError("");
          }}
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
        {domainError && <p className="text-[11px]" style={{ color: "var(--t-status-error)" }}>{domainError}</p>}
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
  busy: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}

function TokenCard({ info, fresh, locked, busy, onRotate, onRevoke }: TokenCardProps) {
  const { t } = useTranslation();
  const { color, bg } = roleChipColors(info.role);
  const created = formatDateTime(info.created_at, SHORT_DATE);
  const isExpired = expired(info.expires_at);
  const expiry = info.expires_at
    ? t(isExpired ? "members.enrollment.expiredOn" : "members.enrollment.expiresOn", { date: formatDateTime(info.expires_at, SHORT_DATE) })
    : t("members.enrollment.neverExpires");
  const summary = [
    ...(info.allowed_domains.length ? [info.allowed_domains.join(", ")] : []),
    t(info.require_approval ? "members.enrollment.approvalOn" : "members.enrollment.approvalOff"),
    ...(isExpired ? [] : [expiry]),
  ].join(" · ");

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-(--t-bg-card)">
      <div className="flex items-start gap-2">
        <span className="text-[10px] px-2 py-0.5 rounded-full capitalize shrink-0" style={{ color, background: bg }}>
          {roleLabel(t, info.role)}
        </span>
        <span className="text-[11px] text-(--t-text-secondary) flex-1 min-w-0 break-words">{summary}</span>
      </div>

      {isExpired && (
        <p className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--t-status-error)" }}>
          <Icon icon="lucide:clock-alert" width={12} className="mt-0.5 shrink-0" />
          <span>{`${expiry} · ${t("members.enrollment.expiredHint")}`}</span>
        </p>
      )}

      {fresh && (
        <>
          <CopySecretField value={fresh} mono ariaLabel={t("members.enrollment.tokenLabel")} />
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
            disabled={busy}
            className="shrink-0 disabled:opacity-50 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-(--t-border) text-(--t-text-secondary)"
          >
            <Icon icon="lucide:refresh-cw" width={12} />
            {t("members.enrollment.rotate")}
          </button>
        )}
        <button onClick={onRevoke} disabled={busy} className="shrink-0 disabled:opacity-50 px-2.5 py-1 rounded-lg text-[11px]" style={{ color: "var(--t-status-error)" }}>
          {t("members.enrollment.revoke")}
        </button>
      </div>
      {!fresh && <span className="text-[10px] text-(--t-text-dim)">{t("members.enrollment.notShownAgain")}</span>}
    </div>
  );
}
