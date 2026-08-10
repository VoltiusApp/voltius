import { useCallback } from "react";
import { Icon } from "@iconify/react";
import { stripAnsi, useLogStream } from "../useLogStream";

interface Props {
  streamKey: string;
  displayName: string;
  startStream: (tail: number) => Promise<string>;
  onBack: () => void;
}

export function LogsView({ streamKey, displayName, startStream, onBack }: Props) {
  const start = useCallback(() => startStream(200), [startStream]);
  const { lines, autoScroll, setAutoScroll, bottomRef } = useLogStream(streamKey, start);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-(--t-border) shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-sm hover:bg-(--t-bg-hover) text-(--t-text-muted)"
        >
          <Icon icon="lucide:arrow-left" width={14} />
        </button>
        <span className="text-[11px] font-mono text-(--t-text) truncate flex-1">
          {displayName}
        </span>
        <button
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
          className={`p-1 rounded text-[11px] ${
            autoScroll
              ? "text-(--t-status-connected)"
              : "text-(--t-text-muted) hover:bg-(--t-bg-hover)"
          }`}
        >
          <Icon icon="lucide:chevrons-down" width={13} />
        </button>
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto font-mono text-[10px] leading-4 px-2 py-1 select-text">
        {lines.length === 0 && (
          <p className="text-(--t-text-muted) opacity-50 mt-2">Waiting for logs…</p>
        )}
        {lines.map((l, i) => (
          <div
            key={i}
            className={l.stream === "stderr" ? "text-(--t-status-error)" : "text-(--t-text)"}
          >
            {stripAnsi(l.line)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
