import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { buildDeepLink } from "@/services/deepLinkUrl";
import { userFacingReason } from "@/services/errorReason";
import { runTeamAction } from "@/services/teamActionFeedback";
import { writeClipboard } from "@/utils/clipboard";
import {
  createJoinGrant,
  isGrantableRole,
  listJoinGrants,
  revokeJoinGrant,
  type GrantableRole,
  type JoinGrant,
} from "@/services/teamJoinGrants";
import { clampMaxUses, clampTtlSecs, expiresIn, TTL_PRESETS, USES_PRESETS, usesRemaining } from "./joinLinkModel";
import { roleChipColors } from "@/components/members/roleChips";
import { ChoiceChip } from "./ChoiceChip";
import type { TeamRole } from "@/stores/teamStore";
import { assignableRoles } from "./vaultShareModel";

interface Props {
  teamId: string;
  roles: TeamRole[];
  canMint: boolean;
}

/**
 * Open join links for a team vault (issue #68).
 *
 * Two honesty rules drive the whole layout:
 *
 * 1. A link confers **membership, not vault access**. The vault key is wrapped
 *    per member with X25519, so it cannot travel in a link — the joiner waits
 *    in `awaiting_key` until an online key-holder wraps it. The tab says so
 *    rather than letting a manager assume the link is a key.
 * 2. The secret is returned by the mint call and **never again** — only its
 *    sha256 is stored. So a listed grant has no copyable URL, and this tab must
 *    not render a Copy button that would produce a broken link. Only the grant
 *    minted in this session, still held in memory, offers one.
 */
export function JoinLinksTab({ teamId, roles, canMint }: Props) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<JoinGrant[] | null>(null);
  const [error, setError] = useState("");
  const [minting, setMinting] = useState(false);
  const [creating, setCreating] = useState(false);

  // The URL for a grant minted in this session, keyed by grant id. Never
  // persisted: writing a live join secret to disk would outlive the tab.
  const [freshLinks, setFreshLinks] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const options = assignableRoles(roles).filter((r) => isGrantableRole(r.name));
  const [role, setRole] = useState<GrantableRole | null>(null);
  const [maxUses, setMaxUses] = useState<number>(1);
  const [ttlSecs, setTtlSecs] = useState<number>(TTL_PRESETS[2].secs);

  useEffect(() => {
    // Least privileged of what this team actually offers, never a hardcoded
    // "member": a link is unattended credential material.
    if (!role && options.length > 0) setRole(options[options.length - 1].name as GrantableRole);
  }, [options, role]);

  const reload = () => {
    setError("");
    listJoinGrants(teamId)
      .then(setGrants)
      .catch((e) => {
        setGrants([]);
        setError(t("members.joinLinks.loadFailed", { reason: userFacingReason(e) }));
      });
  };

  useEffect(reload, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mint = async () => {
    if (!role) return;
    setMinting(true);
    try {
      const grant = await runTeamAction({
        pending: t("members.joinLinks.toast.creating"),
        success: t("members.joinLinks.toast.created"),
        error: (e: Error) => t("members.joinLinks.toast.createFailed", { reason: userFacingReason(e) }),
        run: () =>
          createJoinGrant(teamId, {
            role,
            maxUses: clampMaxUses(maxUses),
            expiresInSecs: clampTtlSecs(ttlSecs),
          }),
      });
      setFreshLinks((prev) => ({
        ...prev,
        [grant.id]: buildDeepLink({ route: "vault-join", grantId: grant.id, secret: grant.secret }),
      }));
      // Folded away again so the new link, which is only readable now, is what
      // the tab shows rather than the form that made it.
      setCreating(false);
      reload();
    } catch {
      // runTeamAction already toasted the reason; the tab stays as it was.
    } finally {
      setMinting(false);
    }
  };

  const revoke = async (grant: JoinGrant) => {
    try {
      await runTeamAction({
        pending: t("members.joinLinks.toast.revoking"),
        success: t("members.joinLinks.toast.revoked"),
        error: (e: Error) => t("members.joinLinks.toast.revokeFailed", { reason: userFacingReason(e) }),
        run: () => revokeJoinGrant(teamId, grant.id),
      });
      setFreshLinks(({ [grant.id]: _gone, ...rest }) => rest);
      reload();
    } catch {
      // Already toasted.
    }
  };

  const copy = async (grantId: string, url: string) => {
    await writeClipboard(url);
    setCopiedId(grantId);
    setTimeout(() => setCopiedId((id) => (id === grantId ? null : id)), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* The single most important sentence on this tab. */}
      <p className="text-[11px] leading-relaxed text-(--t-text-secondary)">
        {t("members.joinLinks.explainer")}
      </p>

      {error && (
        <p className="text-[11px]" style={{ color: "var(--t-status-error)" }}>
          {error}
        </p>
      )}

      {grants !== null && grants.length === 0 && !error && (
        <p className="text-[11px] text-(--t-text-dim)">{t("members.joinLinks.empty")}</p>
      )}

      <div className="flex flex-col gap-1.5">
        {(grants ?? []).map((grant) => {
          const expiry = expiresIn(grant.expires_at);
          const { color, bg } = roleChipColors(grant.role);
          const url = freshLinks[grant.id];
          return (
            <div key={grant.id} className="flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-(--t-bg-card)">
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full capitalize shrink-0"
                  style={{ color, background: bg }}
                >
                  {grant.role}
                </span>
                <span
                  className="text-[11px] text-(--t-text-secondary) flex-1 min-w-0"
                  // The friendly count is rounded; this is the exact moment.
                  title={new Date(grant.expires_at).toLocaleString()}
                >
                  {t("members.joinLinks.usesLeft", {
                    count: usesRemaining(grant),
                    max: grant.max_uses,
                  })}
                  {" · "}
                  {expiry.unit === "expired"
                    ? t("members.joinLinks.expiringNow")
                    : t(`members.joinLinks.expiresIn.${expiry.unit}`, { count: expiry.count })}
                </span>
                {canMint && (
                  <button
                    title={t("members.joinLinks.revoke")}
                    onClick={() => void revoke(grant)}
                    className="p-1.5 rounded-lg shrink-0"
                    style={{ color: "var(--t-status-error)" }}
                  >
                    <Icon icon="lucide:x" width={14} />
                  </button>
                )}
              </div>

              {url ? (
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-2 py-1 rounded-md bg-(--t-bg-elevated) border border-(--t-border) text-[10px] text-(--t-text-secondary) outline-none"
                  />
                  <button
                    onClick={() => void copy(grant.id, url)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0"
                    style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
                  >
                    {copiedId === grant.id ? t("members.joinLinks.copied") : t("members.joinLinks.copy")}
                  </button>
                </div>
              ) : (
                // Not a failure — the server keeps only the secret's hash, so
                // there is nothing to copy. Saying so beats a dead button.
                <span className="text-[10px] text-(--t-text-dim)">{t("members.joinLinks.secretNotRecoverable")}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* The form is folded away by default. The popover this tab lives in is
          capped at 320px tall, and an always-open form pushed Create below the
          fold — while the common visit is to check or revoke a link, not mint
          one. */}
      {canMint && !creating && (
        <button
          onClick={() => setCreating(true)}
          className="self-start px-3 py-1.5 rounded-lg text-[11px] font-medium"
          style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
        >
          {t("members.joinLinks.newLink")}
        </button>
      )}

      {canMint && creating && (
        <div className="flex flex-col gap-3 pt-3 border-t border-(--t-border)">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-(--t-text-secondary)">
              {t("members.joinLinks.joinsAs")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {options.map((r) => (
                <ChoiceChip
                  key={r.id}
                  label={r.name}
                  capitalize
                  selected={r.name === role}
                  onClick={() => setRole(r.name as GrantableRole)}
                />
              ))}
            </div>
          </div>

          {/* Side by side: two stacked chip rows overflowed the popover. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-(--t-text-secondary)">
                {t("members.joinLinks.usesLabel")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {USES_PRESETS.map((n) => (
                  <ChoiceChip key={n} label={String(n)} selected={n === maxUses} onClick={() => setMaxUses(n)} />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-(--t-text-secondary)">
                {t("members.joinLinks.expiryLabel")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {TTL_PRESETS.map((preset) => (
                  <ChoiceChip
                    key={preset.key}
                    label={t(`members.joinLinks.ttl.${preset.key}`)}
                    selected={preset.secs === ttlSecs}
                    onClick={() => setTtlSecs(preset.secs)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void mint()}
              disabled={!role || minting}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-50"
              style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
            >
              {t("members.joinLinks.create")}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] text-(--t-text-secondary)"
            >
              {t("members.joinLinks.cancel")}
            </button>
          </div>
          <p className="text-[10px] text-(--t-text-dim)">{t("members.joinLinks.shownOnce")}</p>
        </div>
      )}
    </div>
  );
}

