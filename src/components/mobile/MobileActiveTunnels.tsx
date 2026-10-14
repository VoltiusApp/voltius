import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "@iconify/react";
import { useActiveTunnelCards } from "@/hooks/useActiveTunnelCards";
import { formatActiveTunnelLabel, getLocalTunnelHttpUrl } from "@/utils/tunnelFormat";
import { sessionLabel } from "@/utils/sessionLabel";
import { TunnelStatusDot } from "@/components/shared/TunnelStatusDot";
import { TunnelTypeBadge } from "@/components/port_forwarding/ActiveTunnelsSection";

function RowButton({ icon, label, busy, onTap }: { icon: string; label: string; busy?: boolean; onTap: () => void }) {
  return (
    <button aria-label={label} disabled={busy} onClick={onTap} className="shrink-0 p-2 text-(--t-text-primary) disabled:opacity-60">
      <Icon icon={busy ? "lucide:loader-circle" : icon} width={18} className={busy ? "animate-spin" : undefined} />
    </button>
  );
}

function TunnelRow({ dot, title, badges, detail, error, children }: { dot: ReactNode; title: string; badges: ReactNode; detail: string; error?: boolean; children: ReactNode }) {
  return (
    <div data-pf-active className="w-full flex items-center gap-3 px-4 py-2">
      <div className="w-9 flex justify-center">{dot}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-(--t-text-primary) truncate">{title}</span>
          {badges}
        </div>
        <div className={`text-[11px] font-mono truncate ${error ? "text-red-400" : "text-(--t-text-dim)"}`}>{detail}</div>
      </div>
      {children}
    </div>
  );
}

/** Auto-detected and ad-hoc forwards of every connected host, which mobile has no Ports panel for. */
export default function MobileActiveTunnels() {
  const { t } = useTranslation();
  const { sessionCards, totalTunnelCount, isKeyBusy, pause, resume, deletePaused } = useActiveTunnelCards();
  if (totalTunnelCount === 0) return null;

  const autoBadge = (auto: boolean) => (
    <span className={`text-[10px] px-1 py-0.5 rounded-sm font-medium shrink-0 leading-none ${auto ? "bg-purple-500/20 text-purple-400" : "bg-(--t-bg-subtle) text-(--t-text-muted)"}`}>
      {auto ? t("portForwarding.activeTunnels.auto") : t("portForwarding.activeTunnels.adHoc")}
    </span>
  );

  return (
    <div data-pf-active-section className="pb-2">
      <div className="px-4 pt-2 pb-1 text-xs font-medium text-(--t-text-dim)">{t("portForwarding.activeTunnels.sectionTitle")}</div>
      {sessionCards.map(({ session, tunnels, suppressedPorts }) => (
        <div key={session.id}>
          <div className="px-4 pt-1 text-[11px] text-(--t-text-dim) truncate">{sessionLabel(session)}</div>
          {tunnels.map((tunnel) => {
            const isError = typeof tunnel.state === "object" && "error" in tunnel.state;
            const webUrl = isError ? null : getLocalTunnelHttpUrl(tunnel.tunnel_type ?? "local", tunnel.remote_port, tunnel.local_port, tunnel.bind_host);
            return (
              <TunnelRow
                key={tunnel.id}
                dot={<TunnelStatusDot status={isError ? "error" : "active"} remoteListening={tunnel.remote_listening} />}
                title={tunnel.tunnel_type === "dynamic"
                  ? t("portForwarding.activeTunnels.socksPortLabel", { port: tunnel.local_port })
                  : t("portForwarding.activeTunnels.portLabel", { port: tunnel.remote_port })}
                badges={<>{autoBadge(tunnel.origin.type === "auto")}<TunnelTypeBadge tunnelType={tunnel.tunnel_type} /></>}
                detail={isError ? (tunnel.state as { error: string }).error : formatActiveTunnelLabel(tunnel)}
                error={isError}
              >
                {webUrl && <RowButton icon="lucide:globe" label={t("portForwarding.activeTunnels.openUrl", { url: webUrl })} onTap={() => void openUrl(webUrl)} />}
                <RowButton icon="lucide:pause" label={t("portForwarding.activeTunnels.pauseForwarding")} busy={isKeyBusy(`${session.id}-${tunnel.id}`)} onTap={() => void pause(session.id, tunnel.id)} />
              </TunnelRow>
            );
          })}
          {suppressedPorts.map((port) => (
            <TunnelRow
              key={`suppressed-${port}`}
              dot={<TunnelStatusDot status="idle" />}
              title={t("portForwarding.activeTunnels.portLabel", { port })}
              badges={autoBadge(true)}
              detail={`${port} → 127.0.0.1:${port}`}
            >
              <RowButton icon="lucide:play" label={t("portForwarding.activeTunnels.resumeForwarding")} busy={isKeyBusy(`${session.id}-${port}`)} onTap={() => void resume(session.id, port)} />
              <RowButton icon="lucide:trash-2" label={t("common.action.delete")} onTap={() => deletePaused(session.id, port)} />
            </TunnelRow>
          ))}
        </div>
      ))}
    </div>
  );
}
