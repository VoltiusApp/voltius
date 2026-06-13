import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useSessionStore } from "@/stores/sessionStore";
import { isRunnableSession } from "@/services/snippetRun";

export default function SnippetTargetSheet({ snippetName, onPick, onClose }: {
  snippetName: string;
  onPick: (sessionId: string) => void;
  onClose: () => void;
}) {
  // Select the raw (stable-ref) sessions array and filter in render. A selector that
  // returns `.filter(...)` produces a new array every getSnapshot call, which makes
  // useSyncExternalStore (zustand v5) loop infinitely → React #185 whitescreen.
  const allSessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = allSessions.filter(isRunnableSession);
  return (
    <BottomSheet title={`Run "${snippetName}" into…`} onClose={onClose}>
      {sessions.map((s) => (
        <button key={s.id} data-snippet-target={s.id}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
          onClick={() => { onPick(s.id); onClose(); }}>
          <Icon icon="lucide:square-terminal" width={18} className="text-(--t-text-dim)" />
          <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{s.connectionName}</span>
          {s.id === activeSessionId && <span className="text-xs text-(--t-text-dim)">active</span>}
        </button>
      ))}
    </BottomSheet>
  );
}
