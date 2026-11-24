import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { applyTmuxStatus, liveSession, startTmuxInstall } from "@/services/tmuxOnConnect";
import { tmuxRemove } from "@/services/tmuxInstall";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { notifyError } from "@/utils/notifyError";

interface TmuxHostActions {
  live: string | undefined;
  hostName: string;
  gate: string | undefined;
  install: () => void;
  askRemove: () => void;
  removeModal: ReactNode;
}

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

/** A saved connection's name (its host when unnamed), or "" when no personal or team connection has this id. */
export function connectionLabel(s: ConnectionState, connectionId: string | undefined): string {
  const c = [...s.connections, ...Object.values(s.teamConnections).flat()].find((x) => x.id === connectionId);
  return c ? c.name || c.host : "";
}

export function useTmuxHostActions(connectionId: string | undefined): TmuxHostActions {
  const { t } = useTranslation();
  const live = useSessionStore(() => (connectionId ? liveSession(connectionId) : undefined));
  const hostName = useConnectionStore((s) => connectionLabel(s, connectionId));
  const [confirmRemove, setConfirmRemove] = useState(false);

  const remove = async () => {
    setConfirmRemove(false);
    if (!live || !connectionId) return;
    try {
      applyTmuxStatus(connectionId, await tmuxRemove(live));
    } catch (e) {
      notifyError(e);
    }
  };

  return {
    live,
    hostName,
    gate: live ? undefined : t("connections.form.mux.connectFirst"),
    install: () => {
      if (live && connectionId) startTmuxInstall(live, connectionId, hostName);
    },
    askRemove: () => setConfirmRemove(true),
    removeModal: confirmRemove && (
      <ConfirmModal
        title={t("connections.form.mux.removeTitle")}
        message={t("connections.form.mux.removeMessage")}
        confirmLabel={t("connections.form.mux.remove")}
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    ),
  };
}
