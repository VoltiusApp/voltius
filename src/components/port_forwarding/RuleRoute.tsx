import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { formInputClass, formInputStyle, formLabelClass, formLabelStyle } from "@/components/shared/Panel";
import { Pills } from "@/components/shared/Pills";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { writeClipboard } from "@/utils/clipboard";
import { AUDIENCE_HOST, audienceOf, type Audience, type RouteSummary as Summary } from "@/utils/tunnelRoute";

export function HopCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-(--t-border) bg-(--t-bg-base) p-3 space-y-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-(--t-text-dim)">
        <Icon icon={icon} width={13} />
        {title}
      </div>
      {children}
    </div>
  );
}

export function HopArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-(--t-text-dim)">
      <Icon icon="lucide:arrow-down" width={14} className="text-(--t-accent)" />
      {label}
    </div>
  );
}

function PortInput({ label, placeholder, value, onChange }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className={formLabelClass} style={formLabelStyle}>{label}</label>
      <input type="number" min={1} max={65535} className={formInputClass} style={formInputStyle}
        placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} required />
    </div>
  );
}

export function ListenerFields({ side, portLabel, portPlaceholder, port, onPort, bindHost, onBindHost }: {
  side: "computer" | "server";
  portLabel: string;
  portPlaceholder: string;
  port: string;
  onPort: (value: string) => void;
  bindHost: string;
  onBindHost: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [audience, setAudience] = useState<Audience>(audienceOf(bindHost));
  const options = [
    { value: "private" as const, label: t(`portForwarding.ruleForm.audience.${side === "server" ? "serverOnly" : "thisComputer"}`) },
    { value: "network" as const, label: t("portForwarding.ruleForm.audience.network") },
    { value: "custom" as const, label: t("portForwarding.ruleForm.audience.custom") },
  ];

  function pick(next: Audience) {
    setAudience(next);
    if (next !== "custom") onBindHost(AUDIENCE_HOST[next]);
    else if (audienceOf(bindHost) !== "custom") onBindHost("");
  }

  return (
    <>
      <PortInput label={portLabel} placeholder={portPlaceholder} value={port} onChange={onPort} />
      <div>
        <label className={formLabelClass} style={formLabelStyle}>{t("portForwarding.ruleForm.whoCanConnect")}</label>
        <Pills options={options} value={audience} onChange={pick} />
        {audience === "custom" && (
          <input className={`${formInputClass} mt-2`} style={formInputStyle} placeholder="192.168.1.2"
            aria-label={t("portForwarding.ruleForm.audience.customAddress")}
            value={bindHost} onChange={(e) => onBindHost(e.target.value)} />
        )}
        {audience !== "private" && (
          <p className="mt-1.5 flex gap-1.5 text-[10px] leading-relaxed text-amber-400">
            <Icon icon="lucide:triangle-alert" width={12} className="mt-0.5 shrink-0" />
            {t(`portForwarding.ruleForm.sharedWarning.${side}`)}
          </p>
        )}
      </div>
    </>
  );
}

export function EndpointFields({ host, onHost, port, onPort }: {
  host: string;
  onHost: (value: string) => void;
  port: string;
  onPort: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[1fr_5.5rem] gap-2">
      <div>
        <label className={formLabelClass} style={formLabelStyle}>{t("portForwarding.ruleForm.host")}</label>
        <input className={formInputClass} style={formInputStyle} placeholder="127.0.0.1"
          value={host} onChange={(e) => onHost(e.target.value)} />
      </div>
      <PortInput label={t("portForwarding.ruleForm.port")} placeholder="3000" value={port} onChange={onPort} />
    </div>
  );
}

export function RouteSummary({ summary }: { summary: Summary | null }) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(1200);
  const strong = <span className="font-mono text-(--t-text-primary)" />;

  return (
    <div className="mt-3 rounded-lg border border-(--t-border) bg-(--t-bg-card) p-3">
      <p className="text-xs leading-relaxed text-(--t-text-secondary)">
        {summary ? (
          <Trans
            i18nKey={`portForwarding.ruleForm.summary.${summary.variant}`}
            values={{ listener: summary.listener, target: summary.target }}
            components={{ b: strong }}
            shouldUnescape
          />
        ) : t("portForwarding.ruleForm.summary.incomplete")}
      </p>
      {summary && (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-(--t-bg-base) px-2 py-1.5">
          <code className="flex-1 break-all font-mono text-[11px] leading-relaxed text-(--t-text-dim)">{summary.command}</code>
          <button type="button" title={t("portForwarding.ruleForm.summary.copyCommand")}
            className="mt-0.5 shrink-0 text-(--t-text-muted) hover:text-(--t-text-primary)"
            onClick={() => { void writeClipboard(summary.command).then(() => flash()); }}>
            <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={13} />
          </button>
        </div>
      )}
    </div>
  );
}
