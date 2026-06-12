import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import type { SerialConnectParams } from "@/types";
import { serialListPorts } from "@/services/serial";
import { Pills } from "@/components/shared/Pills";
import { FormSelect } from "@/components/shared/FormSelect";
import { PortInput } from "@/components/shared/PortInput";

const BAUD_RATE_PRESETS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

export function EphemeralSerialConfigOverlay({
  sessionId,
  initialPort,
  onConnect,
  onDismiss,
}: {
  sessionId: string;
  initialPort?: string;
  onConnect: (params: SerialConnectParams) => void;
  onDismiss?: () => void;
}) {
  const [port, setPort] = useState(initialPort ?? "");
  const [baud, setBaud] = useState(115200);
  const [dataBits, setDataBits] = useState(8);
  const [parity, setParity] = useState("none");
  const [stopBits, setStopBits] = useState(1);
  const [flowControl, setFlowControl] = useState("none");
  const [availablePorts, setAvailablePorts] = useState<{ name: string; path: string }[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    serialListPorts().then(setAvailablePorts).catch(() => {});
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-(--t-bg-terminal)">
      <div className="flex flex-col items-center gap-5 w-80 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Icon icon="lucide:ethernet-port" width={22} className="text-accent" />
        </div>
        <div>
          <p className="text-text-primary font-medium text-base leading-tight">Serial Connection</p>
          <p className="text-text-muted text-xs mt-1">Configure the port before connecting</p>
        </div>
        <div className="w-full space-y-3 text-left">
          <div>
            <label className="text-xs text-(--t-text-dim) mb-1 block">Port</label>
            <PortInput
              value={port}
              ports={availablePorts}
              onChange={setPort}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-(--t-text-dim) mb-1 block">Baud Rate</label>
            <FormSelect
              value={String(baud)}
              options={BAUD_RATE_PRESETS.map((r) => ({ value: String(r), label: r.toLocaleString() }))}
              onChange={(v) => setBaud(Number(v))}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
          >
            <Icon icon={showAdvanced ? "lucide:chevron-up" : "lucide:chevron-down"} width={12} />
            Advanced
          </button>
          {showAdvanced && (
            <>
              <div>
                <label className="text-xs text-(--t-text-dim) mb-1 block">Data Bits</label>
                <Pills
                  options={[{ value: "5", label: "5" }, { value: "6", label: "6" }, { value: "7", label: "7" }, { value: "8", label: "8" }]}
                  value={String(dataBits)}
                  onChange={(v) => setDataBits(Number(v))}
                />
              </div>
              <div>
                <label className="text-xs text-(--t-text-dim) mb-1 block">Stop Bits</label>
                <Pills
                  options={[{ value: "1", label: "1" }, { value: "2", label: "2" }]}
                  value={String(stopBits)}
                  onChange={(v) => setStopBits(Number(v))}
                />
              </div>
              <div>
                <label className="text-xs text-(--t-text-dim) mb-1 block">Parity</label>
                <Pills
                  options={[{ value: "none", label: "None" }, { value: "even", label: "Even" }, { value: "odd", label: "Odd" }]}
                  value={parity}
                  onChange={setParity}
                />
              </div>
              <div>
                <label className="text-xs text-(--t-text-dim) mb-1 block">Flow Control</label>
                <Pills
                  options={[{ value: "none", label: "None" }, { value: "xon-xoff", label: "XON/XOFF" }, { value: "rts-cts", label: "RTS/CTS" }]}
                  value={flowControl}
                  onChange={setFlowControl}
                />
              </div>
            </>
          )}
        </div>
        <div className="w-full flex flex-col gap-2">
          <button
            disabled={!port.trim()}
            onClick={() => onConnect({ sessionId, port: port.trim(), baud, dataBits, parity, stopBits, flowControl })}
            className="btn btn-primary w-full px-4 py-2 rounded-lg text-sm font-medium disabled:cursor-not-allowed"
          >
            Connect
          </button>
          {onDismiss && (
            <button onClick={onDismiss} className="w-full px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
