import { useEffect } from "react";
import type React from "react";
import { useTerminal } from "@/hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: string;
  sessionType: "ssh" | "local";
  onClosed?: () => void;
  active?: boolean;
  inputGate?: React.RefObject<() => boolean>;
  encoding?: string;
}

export default function TerminalView({ sessionId, sessionType, onClosed, active, inputGate, encoding }: Props) {
  const { attach, focus, fit } = useTerminal({ sessionId, sessionType, onClosed, inputGate, encoding });

  useEffect(() => {
    if (active) {
      focus();
      fit();
    }
  }, [active, focus, fit]);

  return (
    <div
      ref={attach}
      className="h-full w-full pl-[14px]"
    />
  );
}
