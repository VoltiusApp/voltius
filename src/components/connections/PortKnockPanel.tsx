import { useTranslation } from "react-i18next";
import type { PortKnockSettings, ProxyMode } from "@/types";
import { KNOCK_DEFAULTS, MAX_KNOCK_STEPS, type KnockProtocol, type KnockStep } from "@/services/portKnock";
import { isCustomProxyMode } from "@/services/proxy";
import type { StoredSecretsState } from "@/hooks/useStoredSecrets";
import { useListReorder } from "@/hooks/useListReorder";
import { ReorderableRow } from "@/components/shared/reorder";
import { SlideOverHeader, DashedAddButton } from "@/components/shared/slideOver";
import { StoredSecretsNote } from "@/components/shared/VaultUnavailableNote";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";
import { SettingRow, SectionLabel, FormHint } from "./formShared";

export type KnockPanelIssue = "empty" | "port" | "udp-proxy" | "udp-system";
export type KnockStepRow = KnockStep & { id: string };
type KnockProxyMode = ProxyMode | "none";

export function knockPanelIssues(settings: PortKnockSettings, steps: KnockStep[], mode: KnockProxyMode): KnockPanelIssue[] {
  if (!settings.enabled) return [];
  if (steps.length === 0) return ["empty"];
  const issues: KnockPanelIssue[] = [];
  if (steps.some((s) => !Number.isInteger(s.port) || s.port < 1 || s.port > 65535)) issues.push("port");
  if (steps.some((s) => s.protocol === "udp")) {
    if (isCustomProxyMode(mode)) issues.push("udp-proxy");
    else if (mode === "system") issues.push("udp-system");
  }
  return issues;
}

const TIMING = [
  { key: "delay_ms", icon: "lucide:timer", label: "connections.knock.delay", unit: "ms", maxLength: 6, placeholder: String(KNOCK_DEFAULTS.delay_ms) },
  { key: "settle_ms", icon: "lucide:hourglass", label: "connections.knock.settle", unit: "ms", maxLength: 6, placeholder: String(KNOCK_DEFAULTS.settle_ms) },
  { key: "window_secs", icon: "lucide:shield-check", label: "connections.knock.window", unit: "s", maxLength: 5, placeholder: "—" },
] as const;

const PROTOCOLS = [
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const digits = (raw: string) => raw.replace(/\D/g, "");

interface Props {
  settings: PortKnockSettings;
  steps: KnockStepRow[];
  sequenceState: StoredSecretsState;
  onSettingsChange: (next: PortKnockSettings) => void;
  onStepsChange: (next: KnockStepRow[]) => void;
  effectiveProxyMode: KnockProxyMode;
  bastionName: string | null;
  onBack: () => void;
}

export default function PortKnockPanel({ settings, steps, sequenceState, onSettingsChange, onStepsChange, effectiveProxyMode, bastionName, onBack }: Props) {
  const { t } = useTranslation();
  const dnd = useListReorder(steps, onStepsChange);
  const sequenceShown = sequenceState === "ok";
  const issues = sequenceShown ? knockPanelIssues(settings, steps, effectiveProxyMode) : [];
  const updateStep = (id: string, patch: Partial<KnockStep>) =>
    onStepsChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-(--t-bg-card)">
      <SlideOverHeader icon="lucide:door-closed-locked" title={t("connections.knock.title")} onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2" {...dnd.containerProps}>
        <SettingRow icon="lucide:power" label={t("connections.knock.enable")}>
          <Toggle checked={settings.enabled} onChange={(enabled) => onSettingsChange({ ...settings, enabled })} />
        </SettingRow>
        <FormHint>{t("connections.knock.hint")}</FormHint>
        {bastionName && <FormHint>{t("connections.knock.viaBastion", { name: bastionName })}</FormHint>}

        {sequenceShown ? (
          <>
            <SectionLabel className="pt-2">{t("connections.knock.sequence")}</SectionLabel>
            <FormHint>{t("connections.knock.reorderHint")}</FormHint>
            {steps.map((step, idx) => (
              <ReorderableRow
                key={step.id}
                dnd={dnd}
                id={step.id}
                index={idx}
                onRemove={() => onStepsChange(steps.filter((s) => s.id !== step.id))}
                removeLabel={t("connections.knock.remove")}
                dragLabel={t("connections.knock.dragToReorder")}
              >
                <input
                  className={`${formInputClass} flex-1 min-w-0`}
                  style={formInputStyle}
                  inputMode="numeric"
                  maxLength={5}
                  aria-label={t("connections.knock.port")}
                  placeholder={t("connections.knock.port")}
                  value={step.port ? String(step.port) : ""}
                  onChange={(e) => updateStep(step.id, { port: Number(digits(e.target.value)) })}
                />
                <FormSelect
                  className="w-20 shrink-0"
                  value={step.protocol}
                  options={PROTOCOLS}
                  onChange={(v) => updateStep(step.id, { protocol: v as KnockProtocol })}
                />
              </ReorderableRow>
            ))}
            <DashedAddButton
              disabled={steps.length >= MAX_KNOCK_STEPS}
              onClick={() => onStepsChange([...steps, { id: crypto.randomUUID(), port: 0, protocol: "tcp" }])}
            >
              {t("connections.knock.addPort")}
            </DashedAddButton>
          </>
        ) : (
          <StoredSecretsNote state={sequenceState} />
        )}

        <SectionLabel className="pt-2">{t("connections.knock.timing")}</SectionLabel>
        {TIMING.map(({ key, icon, label, unit, maxLength, placeholder }) => (
          <SettingRow key={key} icon={icon} label={t(label)}>
            <span className="flex items-center gap-1.5">
              <input
                className={formInputClass}
                style={{ ...formInputStyle, width: "4.5rem" }}
                inputMode="numeric"
                maxLength={maxLength}
                aria-label={t(label)}
                placeholder={placeholder}
                value={settings[key] ?? ""}
                onChange={(e) => {
                  const raw = digits(e.target.value);
                  onSettingsChange({ ...settings, [key]: raw === "" ? undefined : Number(raw) });
                }}
              />
              <span className="w-4">{unit}</span>
            </span>
          </SettingRow>
        ))}
        <FormHint>{t("connections.knock.windowHint")}</FormHint>

        {issues.map((issue) => (
          <p
            key={issue}
            className={`text-xs ${issue === "udp-system" ? "text-(--t-status-warning)" : "text-(--t-status-error)"}`}
          >
            {t(`connections.knock.issue.${issue}`)}
          </p>
        ))}
      </div>
    </div>
  );
}
