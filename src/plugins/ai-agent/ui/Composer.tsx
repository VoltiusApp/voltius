import { useState, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import { useAgentStore, type Mode } from "../state/agentStore";
import { ModeChip } from "./ModeChip";
import { ProfileSwitcher } from "./ProfileSwitcher";

const MODE_TINT: Record<Mode, string> = {
  plan: "var(--t-status-connecting)",
  ask: "var(--t-accent)",
  auto: "var(--t-status-warning)",
};

export function Composer() {
  const [text, setText] = useState("");
  const mode = useAgentStore((s) => s.mode);
  const runStatus = useAgentStore((s) => s.runStatus);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const stop = useAgentStore((s) => s.stop);
  const cycleMode = useAgentStore((s) => s.cycleMode);
  const streaming = runStatus === "streaming";
  const tint = runStatus === "error" ? "var(--t-status-error)" : MODE_TINT[mode];

  const send = () => {
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    void sendMessage(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      cycleMode();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        borderTop: `1px solid ${tint}`,
        background: "var(--t-bg-modal)",
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask the agent…"
        rows={3}
        style={{
          resize: "none",
          background: "var(--t-bg-elevated)",
          color: "var(--t-text-bright)",
          border: "1px solid var(--t-border)",
          borderRadius: 6,
          padding: "6px 8px",
          fontSize: 13,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <ModeChip />
        <ProfileSwitcher />
        <button
          type="button"
          onClick={streaming ? stop : send}
          disabled={!streaming && !text.trim()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            background: streaming ? "var(--t-status-error)" : "var(--t-accent)",
            color: "var(--t-on-accent, #fff)",
            border: "none",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            opacity: !streaming && !text.trim() ? 0.5 : 1,
          }}
        >
          <Icon icon={streaming ? "lucide:square" : "lucide:send"} width={13} />
          {streaming ? "Stop" : "Send"}
        </button>
      </div>
    </div>
  );
}
