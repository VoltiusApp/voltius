import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import {
  resolveTemplate,
  type ParsedVariable,
} from "@/services/snippetParser";

// ─── Typed variable input ─────────────────────────────────────────────────────

interface VarInputProps {
  variable: ParsedVariable;
  value: string;
  onChange: (val: string) => void;
}

function VarInput({ variable, value, onChange }: VarInputProps) {
  const base = {
    background: "var(--t-bg-input)",
    borderColor: "var(--t-border)",
    color: "var(--t-text-primary)",
  };

  const inputClass =
    "w-full px-2.5 py-1.5 text-xs rounded-sm border outline-hidden transition-colors font-mono";

  switch (variable.type) {
    case "boolean":
      return (
        <button
          onClick={() => onChange(value === "true" ? "false" : "true")}
          className="flex items-center gap-2 px-3 py-1.5 rounded-sm border text-xs transition-colors"
          style={{
            background: value === "true" ? "var(--t-accent)" : "var(--t-bg-input)",
            borderColor: value === "true" ? "var(--t-accent)" : "var(--t-border)",
            color: value === "true" ? "var(--t-tab-active-text)" : "var(--t-text-muted)",
          }}
        >
          <Icon
            icon={value === "true" ? "lucide:toggle-right" : "lucide:toggle-left"}
            width={16}
          />
          {value === "true" ? "On" : "Off"}
        </button>
      );

    case "choice":
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          style={base}
        >
          {(variable.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );

    case "number":
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={variable.default ?? "0"}
          className={inputClass}
          style={base}
        />
      );

    case "password":
      return (
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          className={inputClass}
          style={base}
          autoComplete="off"
        />
      );

    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={variable.default ?? variable.name}
          className={inputClass}
          style={base}
        />
      );
  }
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
  snippetName: string;
  /** Template with dynamic vars already resolved. User vars still as {{…}}. */
  partialTemplate: string;
  /** Only user-facing vars (not dynamic). */
  userVars: ParsedVariable[];
  /** Default values pre-filled from variable definitions. */
  initialValues: Record<string, string>;
  onInject: (resolvedText: string, execute: boolean) => void;
  onClose: () => void;
}

export function SnippetVariableModal({
  snippetName,
  partialTemplate,
  userVars,
  initialValues,
  onInject,
  onClose,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  // Focus first input
  const firstInputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = firstInputRef.current?.querySelector("input, select, button");
    if (input) (input as HTMLElement).focus();
  }, []);

  function setValue(name: string, val: string) {
    setValues((prev) => ({ ...prev, [name]: val }));
  }

  const preview = resolveTemplate(partialTemplate, values);

  const allFilled = userVars.every((v) => {
    const val = values[v.name];
    return val !== undefined && val !== "";
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[520px] max-h-[90vh] rounded-xl shadow-2xl border flex flex-col overflow-hidden"
        style={{ background: "var(--t-bg-modal)", borderColor: "var(--t-border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b shrink-0"
          style={{ borderColor: "var(--t-border)" }}
        >
          <div className="flex items-center gap-2">
            <Icon icon="lucide:braces" width={14} style={{ color: "var(--t-accent)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {snippetName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
          >
            <Icon icon="lucide:x" width={14} />
          </button>
        </div>

        {/* Variables */}
        <div className="flex flex-col gap-3 p-4 overflow-y-auto" ref={firstInputRef}>
          {userVars.map((v) => (
            <div key={v.name} className="flex flex-col gap-1">
              <label className="text-[11px] font-medium" style={{ color: "var(--t-text-muted)" }}>
                {v.label ?? v.name}
                {v.type === "password" && (
                  <span
                    className="ml-1.5 text-[10px] px-1 py-0.5 rounded-sm"
                    style={{ background: "var(--t-bg-input)", color: "var(--t-text-muted)" }}
                  >
                    masked
                  </span>
                )}
              </label>
              <VarInput
                variable={v}
                value={values[v.name] ?? ""}
                onChange={(val) => setValue(v.name, val)}
              />
            </div>
          ))}
        </div>

        {/* Preview */}
        <div
          className="mx-4 mb-3 px-3 py-2 rounded-sm border text-[11px] font-mono break-all leading-relaxed"
          style={{
            background: "var(--t-bg-input)",
            borderColor: "var(--t-border)",
            color: "var(--t-text-secondary)",
          }}
        >
          <span className="text-[10px] font-sans block mb-1" style={{ color: "var(--t-text-muted)" }}>
            Preview
          </span>
          {preview}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-4 py-3 border-t shrink-0"
          style={{ borderColor: "var(--t-border)" }}
        >
          <button
            onClick={onClose}
            className="btn btn-ghost px-3 py-1.5 text-xs rounded-lg"
          >
            Cancel
          </button>
          <button
            disabled={!allFilled}
            onClick={() => onInject(preview, false)}
            className="btn btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg"
          >
            <Icon icon="lucide:arrow-down-to-line" width={12} />
            Insert
          </button>
          <button
            disabled={!allFilled}
            onClick={() => onInject(preview, true)}
            className="btn btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg"
          >
            <Icon icon="lucide:play" width={12} />
            Execute
          </button>
        </div>
      </div>
    </div>
  );
}
