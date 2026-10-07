import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { EnvVar } from "@/types";
import { SlideOverHeader, DashedAddButton } from "@/components/shared/slideOver";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";

interface Props {
  envVars: EnvVar[];
  onChange: (updated: EnvVar[]) => void;
  onBack: () => void;
}

export default function EnvVarsPanel({ envVars, onChange, onBack }: Props) {
  const { t } = useTranslation();
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
    <div className="flex flex-col h-full overflow-hidden bg-(--t-bg-card)">
      <SlideOverHeader icon="lucide:file-terminal" title={t("connections.common.environmentVariables")} onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {envVars.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <Icon icon="lucide:file-terminal" width={32} className="text-(--t-text-dim) opacity-40" />
            <p className="text-xs text-(--t-text-dim)">{t("connections.envVarsPanel.emptyTitle")}</p>
            <p className="text-xs text-(--t-text-dim) opacity-70">
              {t("connections.envVarsPanel.emptySubtitle")}
            </p>
          </div>
        ) : (
          <p className="text-xs text-(--t-text-dim) pb-1">
            {t("connections.envVarsPanel.hint")}
          </p>
        )}

        {envVars.map((ev) => (
          <div
            key={ev.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--t-bg-elevated) border border-(--t-border)"
          >
            <input
              className={`${formInputClass} flex-1 min-w-0 font-mono text-xs`}
              style={formInputStyle}
              value={ev.key}
              onChange={(e) => updateVar(ev.id, "key", e.target.value)}
              placeholder={t("connections.envVarsPanel.keyPlaceholder")}
              spellCheck={false}
            />
            <span className="text-xs text-(--t-text-dim) shrink-0">=</span>
            <input
              className={`${formInputClass} flex-1 min-w-0 font-mono text-xs`}
              style={formInputStyle}
              value={ev.value}
              onChange={(e) => updateVar(ev.id, "value", e.target.value)}
              placeholder={t("connections.envVarsPanel.valuePlaceholder")}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => removeVar(ev.id)}
              className="text-(--t-text-dim) hover:text-red-400 transition-colors shrink-0"
              aria-label={t("connections.envVarsPanel.removeAriaLabel")}
            >
              <Icon icon="lucide:x" width={14} />
            </button>
          </div>
        ))}

        <DashedAddButton onClick={addVar}>{t("connections.envVarsPanel.addButton")}</DashedAddButton>
      </div>
    </div>
  );
}
