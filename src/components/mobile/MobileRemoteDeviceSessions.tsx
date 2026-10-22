import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useRemoteSessionCards } from "@/hooks/useRemoteSessionCards";
import type { RemoteSession } from "@/stores/liveSessionManifestCore";
import { GLASS_CARD_STYLE } from "@/components/shared/BaseCard";
import { RemoteSessionCardBody } from "@/components/hosts/RemoteSessionCardBody";
import { sessionLabel } from "@/utils/sessionLabel";
import { useLongPress } from "./useLongPress";
import BottomSheet from "./sheets/BottomSheet";
import { SheetActionRow } from "./sheets/SheetActionRow";

type Cards = ReturnType<typeof useRemoteSessionCards>;

function SessionCard({ session: a, cards, onActions }: { session: RemoteSession; cards: Cards; onActions: () => void }) {
  const state = cards.stateOf(a.sessionId);
  const idle = state === "idle";
  const press = useLongPress(onActions, () => cards.join(a));
  return (
    <div
      role={idle ? "button" : undefined}
      tabIndex={idle ? 0 : undefined}
      data-mobile-remote-session={a.sessionId}
      {...(idle ? press : {})}
      className="shrink-0 flex items-center gap-4 px-3 py-3 rounded-2xl text-left active:opacity-80"
      style={{ ...GLASS_CARD_STYLE, minWidth: 220, maxWidth: 280 }}
    >
      <RemoteSessionCardBody
        session={a}
        state={state}
        joining={cards.joiningId === a.sessionId}
        onUndo={() => cards.undo(a.sessionId)}
        onDismiss={() => cards.dismiss(a.sessionId)}
      />
    </div>
  );
}

/** Mobile "Live on other devices" strip: the desktop cards; long-press opens join / kill. */
export default function MobileRemoteDeviceSessions() {
  const { t } = useTranslation();
  const setTab = useMobileNavStore((s) => s.setTab);
  const cards = useRemoteSessionCards(() => setTab("terminal"));
  const [actionsFor, setActionsFor] = useState<RemoteSession | null>(null);
  if (cards.sessions.length === 0) return null;

  return (
    <div className="pt-3 pb-1" data-mobile-remote-sessions>
      <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim) mb-1 px-4">
        {t("hosts.remoteSessions.title")}
      </p>
      <div className="flex gap-3 overflow-x-auto px-4 py-2" style={{ scrollbarWidth: "none" }}>
        {cards.sessions.map((a) => (
          <SessionCard key={a.sessionId} session={a} cards={cards} onActions={() => setActionsFor(a)} />
        ))}
      </div>
      {actionsFor && (
        <BottomSheet title={sessionLabel(actionsFor)} onClose={() => setActionsFor(null)}>
          <SheetActionRow attr="remote-session-action" it={{
            icon: "lucide:terminal", label: t("hosts.remoteSessions.join"), slug: "join",
            onTap: () => { cards.join(actionsFor); setActionsFor(null); },
          }} />
          <SheetActionRow attr="remote-session-action" it={{
            icon: "lucide:trash-2", label: t("hosts.remoteSessions.kill"), slug: "kill", danger: true,
            onTap: () => { cards.kill(actionsFor.sessionId); setActionsFor(null); },
          }} />
        </BottomSheet>
      )}
    </div>
  );
}
