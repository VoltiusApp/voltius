import { Icon } from "@iconify/react";
import type { EnvVar } from "@/types";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";

interface Props {
  envVars: EnvVar[];
  onChange: (updated: EnvVar[]) => void;
  onBack: () => void;
}

export default function EnvVarsPanel({ envVars, onChange, onBack }: Props) {
  const addVar = () => {
    onChange([...envVars, { id: crypto.randomUUID(), key: "", value: "" }]);
  };

  const updateVar = (id: string, field: "key" | "value", val: string) => {
    onChange(envVars.map((e) => e.id === id ? { ...e, [field]: val } : e));
  };

  const removeVar = (id: string) => {
    onChange(envVars.filter((e) => e.id !== id));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--t-bg-card)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 shrink-0 border-b border-b-[var(--t-bg-terminal)]">
        <button
          onClick={onBack}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] hover:bg-[var(--t-bg-elevated)]"
        >
          <span className="[&_path]:[stroke-width:3]">
            <Icon icon="lucide:arrow-left" width={16} />
          </span>
        </button>
        <Icon icon="lucide:file-terminal" width={14} className="text-[var(--t-text-dim)]" />
        <h2 className="text-sm font-semibold flex-1 text-[var(--t-text-primary)]">Environment Variables</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {envVars.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <Icon icon="lucide:file-terminal" width={32} className="text-[var(--t-text-dim)] opacity-40" />
            <p className="text-xs text-[var(--t-text-dim)]">No environment variables</p>
            <p className="text-xs text-[var(--t-text-dim)] opacity-70">
              Variables will be set when connecting to this host
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--t-text-dim)] pb-1">
            Variables set in the remote session environment
          </p>
        )}

        {envVars.map((ev) => (
          <div
            key={ev.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
          >
            <input
              className={`${formInputClass} flex-1 min-w-0 font-mono text-xs`}
              style={formInputStyle}
              value={ev.key}
              onChange={(e) => updateVar(ev.id, "key", e.target.value)}
              placeholder="KEY"
              spellCheck={false}
            />
            <span className="text-xs text-[var(--t-text-dim)] shrink-0">=</span>
            <input
              className={`${formInputClass} flex-1 min-w-0 font-mono text-xs`}
              style={formInputStyle}
              value={ev.value}
              onChange={(e) => updateVar(ev.id, "value", e.target.value)}
              placeholder="value"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => removeVar(ev.id)}
              className="text-[var(--t-text-dim)] hover:text-red-400 transition-colors shrink-0"
              aria-label="Remove variable"
            >
              <Icon icon="lucide:x" width={14} />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addVar}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-[var(--t-border)] text-xs text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] hover:border-[var(--t-border-hover)] transition-colors"
        >
          <Icon icon="lucide:plus" width={13} />
          Add Variable
        </button>
      </div>
    </div>
  );
}
