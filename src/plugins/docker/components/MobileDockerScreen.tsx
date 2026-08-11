import { useMemo, useState } from "react";
import { Icon, BottomSheet, useT, useSessionById, MobileScreenHeader } from "@voltius/ui";
import type { FC } from "react";
import type { PluginAPI, MobileScreenProps } from "@/plugins/api";
import { createMobileDockerListService } from "../services";
import { useDockerList } from "../useDockerList";
import type { ContainerAction, DockerContainer } from "../types";
import { PortChips } from "./PortChips";

function stateColor(state: string): string {
  if (state === "running") return "var(--t-status-connected)";
  if (state === "paused") return "var(--t-status-warning)";
  return "var(--t-text-dim)";
}

function containerName(c: DockerContainer): string {
  return c.names[0] ?? c.id.slice(0, 12);
}

interface ActionItem {
  action: ContainerAction;
  label: string;
  icon: string;
  danger?: boolean;
}

function actionsFor(state: string, t: PluginAPI["i18n"]["t"]): ActionItem[] {
  if (state === "running") {
    return [
      { action: "stop", label: t("hostStop"), icon: "lucide:square" },
      { action: "restart", label: t("hostRestart"), icon: "lucide:rotate-cw" },
      { action: "pause", label: t("hostPause"), icon: "lucide:pause" },
    ];
  }
  if (state === "paused") {
    return [
      { action: "unpause", label: t("hostResume"), icon: "lucide:play" },
      { action: "stop", label: t("hostStop"), icon: "lucide:square" },
    ];
  }
  return [{ action: "start", label: t("hostStart"), icon: "lucide:play" }];
}

export function createMobileDockerScreen(api: PluginAPI): FC<MobileScreenProps> {
  const dockerListService = createMobileDockerListService();

  return function MobileDockerScreen({ sessionId, onBack }) {
    const t = useT(api);
    const session = useSessionById(api, sessionId);

    const { containers, loading, error, dockerUnreachable, refresh, act, openExecTerminal } = useDockerList(
      dockerListService,
      session ?? undefined,
    );

    const [showAll, setShowAll] = useState(false);
    const [sheetFor, setSheetFor] = useState<DockerContainer | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<DockerContainer | null>(null);

    const ready = session?.type === "ssh" && session.status === "connected";

    const visible = useMemo(
      () => (showAll ? containers : containers.filter((c) => c.state === "running" || c.state === "paused")),
      [containers, showAll],
    );

    const runAction = async (c: DockerContainer, action: ContainerAction) => {
      setSheetFor(null);
      try {
        await act(c.id, action);
      } catch (e) {
        console.error("[docker] action failed:", e);
      }
    };

    let body: React.ReactNode;
    if (!session || session.type !== "ssh") {
      body = <Empty icon="custom:docker" title={t("needsSshTitle")} sub={t("needsSshSub")} />;
    } else if (session.status !== "connected") {
      body = <Empty icon="custom:docker" title={t("sessionNotConnected")} sub={t("sessionNotConnectedSub")} />;
    } else if (dockerUnreachable) {
      body = (
        <Empty
          icon="custom:docker"
          title={t("unreachableTitle")}
          sub={t("unreachableSub")}
          action={{ label: t("refresh"), onClick: () => void refresh() }}
        />
      );
    } else if (error) {
      body = <div className="px-4 py-4 text-xs text-(--t-text-dim) break-all">{error}</div>;
    } else if (visible.length === 0) {
      body = (
        <Empty
          icon="lucide:box"
          title={containers.length === 0 ? t("noContainers") : t("noRunningContainers")}
          sub={containers.length === 0 ? undefined : t("tapRunningToShowAll")}
        />
      );
    } else {
      body = (
        <div className="flex-1 overflow-y-auto">
          {visible.map((c) => {
            const onOpen = () => ready && setSheetFor(c);
            return (
              <div
                key={c.id}
                data-mobile-docker-container={c.id}
                role="button"
                tabIndex={0}
                onClick={onOpen}
                onKeyDown={(e) => {
                  // A keydown on the port-chip button inside this row bubbles up
                  // here; without this guard, preventDefault() on Enter/Space kills
                  // the chip's own activation and reopens the action sheet instead.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen();
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
              >
                <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: stateColor(c.state) }} />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{containerName(c)}</span>
                  <span className="text-xs text-(--t-text-dim) truncate">{c.image}</span>
                  <PortChips ports={c.ports} sessionId={sessionId} isRemote size="md" />
                </span>
                <span className="shrink-0 text-[11px] text-(--t-text-dim) truncate max-w-[40%]">{c.status}</span>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
        <MobileScreenHeader title={t("title")} subtitle={session?.connectionName} onBack={onBack}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-xs px-2 py-1 rounded-lg"
              style={{
                background: showAll ? "var(--t-bg-card)" : "transparent",
                color: showAll ? "var(--t-text-primary)" : "var(--t-text-dim)",
              }}
            >
              {showAll ? t("filterAll") : t("filterRunning")}
            </button>
            <button onClick={() => void refresh()} disabled={loading} className="p-2 text-(--t-text-dim) disabled:opacity-40">
              <Icon icon="lucide:refresh-cw" width={18} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </MobileScreenHeader>

        {body}

        {sheetFor && (
          <BottomSheet title={containerName(sheetFor)} onClose={() => setSheetFor(null)}>
            <div className="flex flex-col">
              {actionsFor(sheetFor.state, t).map((it) => (
                <SheetRow key={it.action} icon={it.icon} label={it.label} onClick={() => void runAction(sheetFor, it.action)} />
              ))}
              <SheetRow
                icon="lucide:scroll-text"
                label={t("logs")}
                onClick={() => {
                  const c = sheetFor;
                  setSheetFor(null);
                  api.ui.pushMobileScreen({ kind: "docker-logs", sessionId, containerId: c.id, containerName: containerName(c) });
                }}
              />
              <SheetRow
                icon="lucide:terminal"
                label={t("execShell")}
                onClick={() => {
                  const c = sheetFor;
                  setSheetFor(null);
                  void openExecTerminal(c.id, containerName(c));
                }}
              />
              <SheetRow
                icon="lucide:trash-2"
                label={t("remove")}
                danger
                onClick={() => {
                  setConfirmRemove(sheetFor);
                  setSheetFor(null);
                }}
              />
            </div>
          </BottomSheet>
        )}

        {confirmRemove && (
          <BottomSheet title={t("removeConfirmTitle")} onClose={() => setConfirmRemove(null)}>
            <div className="flex flex-col gap-3 px-2 py-1">
              <p className="text-xs text-(--t-text-dim)">
                {t("removeConfirmBody", { name: containerName(confirmRemove) })}
              </p>
              <button
                data-mobile-docker-remove-confirm
                onClick={() => {
                  const c = confirmRemove;
                  setConfirmRemove(null);
                  void runAction(c, "remove");
                }}
                className="w-full rounded-xl py-3 text-sm font-medium"
                style={{ background: "var(--t-status-error)", color: "#fff" }}
              >
                {t("remove")}
              </button>
              <button
                onClick={() => setConfirmRemove(null)}
                className="w-full rounded-xl py-3 text-sm text-(--t-text-primary)"
                style={{ background: "var(--t-bg-card)" }}
              >
                {t("cancel")}
              </button>
            </div>
          </BottomSheet>
        )}
      </div>
    );
  };
}

function SheetRow({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      data-mobile-docker-action={label}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 text-left active:bg-(--t-bg-card)"
      style={{ color: danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}
    >
      <Icon icon={icon} width={18} />
      <span className="text-sm">{label}</span>
    </button>
  );
}

function Empty({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-2 text-(--t-text-dim)">
      <Icon icon={icon} width={32} />
      <span className="text-sm text-(--t-text-primary)">{title}</span>
      {sub && <span className="text-xs">{sub}</span>}
      {action && (
        <button onClick={action.onClick} className="mt-2 text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)" }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
