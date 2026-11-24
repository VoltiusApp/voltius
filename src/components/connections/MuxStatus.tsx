import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useTmuxPinVersion } from "@/services/tmuxInstall";
import { useHostMuxStore } from "@/stores/hostMuxStore";
import { useTmuxHostActions } from "./useTmuxHostActions";

const BTN_BASE =
  "shrink-0 text-[11px] px-2 py-1 rounded-md font-medium bg-(--t-bg-input) transition-opacity hover:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed";
const WARN = "var(--t-status-warning)";
const OK = "var(--t-status-connected)";

interface Props {
  connectionId: string | undefined;
  persistOn: boolean;
}

export default function MuxStatus({ connectionId, persistOn }: Props) {
  const { t } = useTranslation();
  const host = useHostMuxStore((s) => (connectionId ? s.hosts[connectionId] : undefined));
  const installing = useHostMuxStore((s) => (connectionId ? s.installing[connectionId] : undefined));
  const failure = useHostMuxStore((s) => (connectionId ? s.lastFailure[connectionId] : undefined));
  const pin = useTmuxPinVersion();
  const { live, hostName, gate, install: runInstall, askRemove, removeModal } = useTmuxHostActions(connectionId);

  if (!persistOn || !connectionId) return null;

  const connectFirst = t("connections.form.mux.connectFirst");

  const line = (icon: string, color: string, text: string, actions?: React.ReactNode, spin = false) => (
    <div className="flex items-start gap-1.5 pl-[19px] pb-1 text-[11px] leading-snug text-(--t-text-dim)">
      <Icon icon={icon} width={12} className={`mt-px shrink-0 ${spin ? "animate-spin" : ""}`} style={{ color }} />
      <span className="flex-1 min-w-0">{text}</span>
      {actions}
    </div>
  );
  const install = (label: string, disabled = !live, title = gate) => (
    <button type="button" className={`${BTN_BASE} text-(--t-text-primary)`} disabled={disabled} title={title} onClick={runInstall}>
      {label}
    </button>
  );
  const installPlain = install(t("connections.form.mux.install"));
  const installPinned = install(pin ? t("connections.form.mux.installPin", { version: pin }) : t("connections.form.mux.install"));

  let body: React.ReactNode;
  if (installing) {
    const step = t(`notifications.tmux.step.${installing.step}`);
    body = (
      <div className="pl-[19px] pb-1 space-y-1">
        {line("lucide:loader-circle", "var(--t-accent)", pin ? t("connections.form.mux.installing", { version: pin, step }) : t("connections.form.mux.installingBare", { step }), undefined, true)}
        <div className="ml-[18px] h-[3px] rounded-full bg-(--t-bg-input) overflow-hidden" role="progressbar" aria-valuenow={Math.round(installing.progress)}>
          <div className="h-full bg-(--t-accent)" style={{ width: `${Math.max(0, Math.min(100, installing.progress))}%` }} />
        </div>
      </div>
    );
  } else if (!host) {
    body = line("lucide:circle-dashed", "var(--t-text-muted)", t("connections.form.mux.unknown"), install(t("connections.form.mux.install"), true, connectFirst));
  } else if (host.kind === "unsupported") {
    const reason = t("connections.form.mux.unsupported");
    body = line("lucide:triangle-alert", WARN, reason, install(t("connections.form.mux.install"), true, reason));
  } else if (host.voltius?.active) {
    body = line(
      "lucide:circle-check",
      OK,
      t("connections.form.mux.voltius", { version: host.voltius.active }),
      <>
        {host.voltius.outdated && install(t("settings.hosts.voltiusTmux.updateNow"))}
        <button type="button" className={`${BTN_BASE} text-(--t-text-muted)`} disabled={!live} title={gate} onClick={askRemove}>
          {t("connections.form.mux.remove")}
        </button>
      </>,
    );
  } else if (host.kind === "tmux-cc") {
    body = line("lucide:circle-check", OK, t("connections.form.mux.system", { version: host.version ?? "" }));
  } else if (host.kind === "tmux-old") {
    body = line("lucide:triangle-alert", WARN, t("connections.form.mux.old", { version: host.version ?? "" }), installPinned);
  } else {
    body = line("lucide:triangle-alert", WARN, t(`connections.form.mux.${host.kind}`), installPlain);
  }

  return (
    <>
      {body}
      {failure && !installing && line("lucide:triangle-alert", "var(--t-status-error)", t(`notifications.tmux.failed.${failure}`, { host: hostName }))}
      {removeModal}
    </>
  );
}
