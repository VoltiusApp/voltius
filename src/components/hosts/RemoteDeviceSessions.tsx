import { useTranslation } from "react-i18next";
import { useRemoteSessionCards } from "@/hooks/useRemoteSessionCards";
import { BaseCard } from "@/components/shared/BaseCard";
import { RemoteSessionCardBody } from "./RemoteSessionCardBody";

export function RemoteDeviceSessions() {
  const { t } = useTranslation();
  const cards = useRemoteSessionCards();
  if (cards.sessions.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
          {t("hosts.remoteSessions.title")}
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto p-8 -m-8" style={{ scrollbarWidth: "none" }}>
        {cards.sessions.map((a) => {
          const state = cards.stateOf(a.sessionId);
          const idle = state === "idle";
          return (
            <BaseCard
              key={a.sessionId}
              glass
              onClick={
                idle
                  ? (e) => {
                      // BaseCard's onContextMenu also calls onClick; opening the Kill menu must not join.
                      if (e.type === "click") cards.join(a);
                    }
                  : undefined
              }
              contextMenuItems={
                idle
                  ? [{ label: t("hosts.remoteSessions.kill"), icon: "lucide:trash-2", danger: true, onClick: () => cards.kill(a.sessionId) }]
                  : undefined
              }
              className="shrink-0"
              style={{ minWidth: 220, maxWidth: 280 }}
            >
              <RemoteSessionCardBody
                session={a}
                state={state}
                joining={cards.joiningId === a.sessionId}
                onUndo={() => cards.undo(a.sessionId)}
                onDismiss={() => cards.dismiss(a.sessionId)}
              />
            </BaseCard>
          );
        })}
      </div>
    </div>
  );
}
