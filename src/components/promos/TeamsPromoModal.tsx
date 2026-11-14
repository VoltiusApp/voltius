import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { PaywallContext } from "@/services/promos";
import { PromoBody, PromoFooter, PromoSurface, PromoTitle } from "./PromoSurface";
import { useTrialActivation, type PromoModalProps } from "./useTrialActivation";

const BENEFITS = [
  { id: "vaults", icon: "lucide:lock" },
  { id: "terminals", icon: "lucide:terminal" },
  { id: "roles", icon: "lucide:shield" },
] as const;

export function TeamsPromoModal({ source, context, onClose }: PromoModalProps & { context?: PaywallContext }) {
  const { t } = useTranslation();
  const { activate, busy, verifyFirst } = useTrialActivation("teams", source, onClose);
  const dismiss = () => onClose("dismissed");

  return (
    <PromoSurface onClose={dismiss} width="55rem">
      <div className="flex flex-col-reverse sm:flex-row">
        <div className="sm:w-[440px] sm:shrink-0 px-6 sm:px-10 pt-6 sm:pt-10 pb-6 sm:pb-8 flex flex-col">
          <PromoTitle>{t(context === "team" ? "shared.promos.teams.titleTeam" : "shared.promos.teams.title")}</PromoTitle>
          <PromoBody>{t("shared.promos.teams.body")}</PromoBody>
          <ul className="mt-6 flex flex-col gap-3.5">
            {BENEFITS.map((b) => (
              <li key={b.id} className="flex items-start gap-3">
                <Icon icon={b.icon} width={18} className="shrink-0 mt-0.5 text-(--t-accent)" />
                <div>
                  <div className="text-sm font-semibold text-(--t-text-bright)">{t(`shared.promos.teams.benefits.${b.id}.title`)}</div>
                  <div className="mt-0.5 text-[13px] text-(--t-text-muted)">{t(`shared.promos.teams.benefits.${b.id}.desc`)}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-6 sm:mt-auto sm:pt-6">
            <PromoFooter
              cta={t(verifyFirst ? "shared.promos.verifyCta" : "shared.promos.teams.cta")}
              onCta={() => void activate()}
              busy={busy}
              note={t("shared.promos.teams.note")}
              secondary={t("shared.promos.teams.later")}
              onSecondary={dismiss}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0 px-4 sm:px-7 pt-4 sm:pt-[54px] pb-4 sm:pb-7 flex flex-col gap-4.5 bg-(--t-bg-base) border-b sm:border-b-0 sm:border-l border-(--t-border)">
          <SharedTerminalDemo />
          <TeamVaultPreview />
        </div>
      </div>
    </PromoSurface>
  );
}

const PROMPT = <span className="text-(--t-status-connected)">prod-api-01</span>;

function DemoPane({ avatar, who, badge, children }: {
  avatar: string;
  who: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[10px] bg-(--t-bg-terminal) ring-1 ring-(--t-border) overflow-hidden">
      <div className="h-[30px] flex items-center gap-1.5 px-2.5 bg-(--t-bg-elevated) border-b border-(--t-border)">
        <span className={`w-4 h-4 rounded-full ${avatar}`} />
        <span className="text-[11px] text-(--t-text-secondary) truncate">{who}</span>
        <span className="ml-auto shrink-0">{badge}</span>
      </div>
      <div className="px-2.5 pt-2 pb-2.5 font-mono text-[11px] leading-[1.75] text-(--t-text-primary)">{children}</div>
    </div>
  );
}

/** You and a teammate typing into the same live terminal from two machines (8s loop). */
function SharedTerminalDemo() {
  const { t } = useTranslation();
  return (
    <figure role="img" aria-label={t("shared.promos.teams.demo.label")} className="m-0 relative flex flex-col gap-2">
      <DemoPane
        avatar="bg-(--t-accent)"
        who={t("shared.promos.teams.demo.you")}
        badge={<span className="text-[11px] font-medium text-(--t-accent)">prod-api-01 · {t("shared.promos.teams.demo.shared")}</span>}
      >
        <div>{PROMPT}$ <span className="promo-typed promo-type-1">tail -f /var/log/api.log</span></div>
        <div className="promo-out-1 text-(--t-text-muted)">pool exhausted (64/64)</div>
        <div className="promo-out-2 text-(--t-status-connected)">api restarted · pool 3/64</div>
      </DemoPane>
      <DemoPane
        avatar="promo-join bg-(--t-status-warning)"
        who={t("shared.promos.teams.demo.teammate")}
        badge={
          <span className="promo-join inline-block px-1.5 rounded-[4px] text-[10px] font-semibold text-(--t-status-warning) ring-1 ring-(--t-status-warning)">
            {t("shared.promos.teams.demo.joined")}
          </span>
        }
      >
        <div>
          {PROMPT}$ <span className="promo-typed promo-type-2">systemctl restart api</span>
          <span className="promo-blink inline-block w-1.5 h-[13px] align-middle bg-(--t-status-warning)" />
        </div>
        <div className="promo-out-2 text-(--t-text-muted)">● api.service active (running)</div>
      </DemoPane>
      <div className="promo-fixed absolute left-1/2 top-[98px] -translate-x-1/2 h-7 px-3 rounded-full flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-(--t-text-bright) bg-(--t-bg-elevated) ring-1 ring-(--t-border) shadow-lg">
        <Icon icon="lucide:check" width={12} className="text-(--t-status-connected)" />
        {t("shared.promos.teams.demo.fixed")}
      </div>
    </figure>
  );
}

const VAULT_HOSTS = [
  { name: "prod-api-01", role: "editor", status: "bg-(--t-status-connected)" },
  { name: "db-primary", role: "connectOnly", status: "bg-(--t-status-connected)" },
  { name: "staging-k8s", role: "editor", status: "bg-(--t-status-warning)" },
] as const;

/** What a shared team vault looks like: hosts with per-member roles. */
function TeamVaultPreview() {
  const { t } = useTranslation();
  return (
    <div aria-hidden="true" className="hidden sm:block">
      <div className="flex items-center gap-2 mb-2">
        <Icon icon="lucide:users" width={14} className="text-(--t-text-muted)" />
        <span className="text-xs font-semibold text-(--t-text-secondary)">{t("shared.promos.teams.demo.vault")}</span>
      </div>
      <div className="flex flex-col border-t border-(--t-border)">
        {VAULT_HOSTS.map((h) => (
          <div key={h.name} className="h-10 flex items-center gap-2.5 border-b border-(--t-border)">
            <span className={`w-[7px] h-[7px] rounded-full ${h.status}`} />
            <span className="text-[13px] text-(--t-text-primary)">{h.name}</span>
            <span className="ml-auto text-[11px] text-(--t-text-muted)">{t(`shared.promos.teams.demo.${h.role}`)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
