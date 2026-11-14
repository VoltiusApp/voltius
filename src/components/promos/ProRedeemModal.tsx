import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PaywallContext } from "@/services/promos";
import { PromoBody, PromoFooter, PromoSurface, PromoTitle } from "./PromoSurface";
import { useTrialActivation, type PromoModalProps } from "./useTrialActivation";

const DOWNLOAD_URL = "https://voltius.app/#download";
const BENEFITS = ["sync", "devices", "vaults", "share"] as const;
const TITLE_KEY: Record<PaywallContext, string> = {
  vaults: "shared.promos.pro.titleVaults",
  sync: "shared.promos.pro.titleSync",
  team: "shared.promos.pro.title",
};

export function ProRedeemModal({ source, context, onClose }: PromoModalProps & { context?: PaywallContext }) {
  const { t } = useTranslation();
  const { activate, busy, verifyFirst } = useTrialActivation("pro", source, onClose);
  const dismiss = () => onClose("dismissed");

  return (
    <PromoSurface onClose={dismiss}>
      <SyncDemo />
      <div className="px-6 sm:px-9 pt-6 pb-5 flex flex-col">
        <PromoTitle>{t(context ? TITLE_KEY[context] : "shared.promos.pro.title")}</PromoTitle>
        <PromoBody>{t("shared.promos.pro.body")}</PromoBody>
        <ul className="mt-4.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4.5 gap-y-2.5">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-center gap-2 text-[13px] text-(--t-text-primary)">
              <Icon icon="lucide:check" width={15} className="shrink-0 text-(--t-accent)" />
              {t(`shared.promos.pro.benefits.${b}`)}
            </li>
          ))}
        </ul>
        <div className="mt-5.5">
          <PromoFooter
            cta={t(verifyFirst ? "shared.promos.verifyCta" : "shared.promos.pro.cta")}
            onCta={() => void activate()}
            busy={busy}
            note={t("shared.promos.pro.note")}
            secondary={t("shared.promos.pro.later")}
            onSecondary={dismiss}
            link={{ label: t("shared.promos.pro.install"), onClick: () => void openUrl(DOWNLOAD_URL).catch(() => {}) }}
          />
        </div>
      </div>
    </PromoSurface>
  );
}

const HOSTS = ["prod-api-01", "db-primary"];

/** A host added on the laptop lands on the phone a moment later, through the cloud. */
function SyncDemo() {
  const { t } = useTranslation();
  const row = "rounded-[6px] bg-(--t-bg-card) flex items-center truncate text-(--t-text-primary)";
  return (
    <figure
      role="img"
      aria-label={t("shared.promos.pro.demo.label")}
      className="m-0 relative h-[236px] flex items-center justify-center px-4 bg-(--t-bg-base) border-b border-(--t-border)"
    >
      <div className="w-[220px] min-w-0 h-[150px] rounded-[10px] bg-(--t-bg-elevated) ring-1 ring-(--t-border) p-2.5 flex flex-col gap-1.5">
        <div className="text-[10px] font-semibold text-(--t-text-muted) mb-0.5">{t("shared.promos.pro.demo.laptop")}</div>
        {HOSTS.map((host) => <div key={host} className={`${row} h-[26px] px-2 text-[11px]`}>{host}</div>)}
        <div className={`${row} promo-add h-[26px] px-2 text-[11px] ring-1 ring-(--t-accent) text-(--t-text-bright)`}>
          homelab-pve
          <span className="ml-auto text-[9px] text-(--t-accent)">{t("shared.promos.pro.demo.new")}</span>
        </div>
      </div>

      <div className="relative w-[150px] min-w-10 shrink h-0.5 mx-1 bg-(--t-border)">
        <span className="promo-dot promo-dot-sync" />
        <span className="absolute left-1/2 -top-[19px] -ml-[19px] w-[38px] h-[38px] rounded-[10px] bg-(--t-bg-elevated) ring-1 ring-(--t-border) flex items-center justify-center z-1">
          <Icon icon="lucide:server" width={18} className="text-(--t-accent)" />
        </span>
        <span className="absolute left-1/2 top-6 -translate-x-1/2 flex items-center gap-1 text-[10px] text-(--t-text-muted) whitespace-nowrap">
          <Icon icon="lucide:lock" width={10} />
          {t("shared.promos.pro.demo.encrypted")}
        </span>
      </div>

      <div className="w-[118px] shrink-0 h-[190px] rounded-[18px] bg-(--t-bg-elevated) ring-1 ring-(--t-border) px-2 py-3.5 flex flex-col gap-1.5">
        <div className="text-[10px] font-semibold text-(--t-text-muted) mb-0.5 pl-0.5">{t("shared.promos.pro.demo.phone")}</div>
        {HOSTS.map((host) => <div key={host} className={`${row} h-6 px-1.5 text-[10px]`}>{host}</div>)}
        <div className={`${row} promo-arrive h-6 px-1.5 text-[10px] text-(--t-text-bright)`}>homelab-pve</div>
      </div>

      <figcaption className="absolute bottom-3.5 inset-x-4 text-center text-[11px] text-(--t-text-muted)">
        {t("shared.promos.pro.demo.caption")}
      </figcaption>
    </figure>
  );
}
