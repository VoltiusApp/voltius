import { useMemo, useState, type ClipboardEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { EnvVar } from "@/types";
import { SlideOverHeader, DashedAddButton } from "@/components/shared/slideOver";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";
import { tint } from "@/components/shared/selectableChip";
import { useCopyText } from "@/hooks/useCopyText";
import { saveTextFile } from "@/services/saveFile";
import { CodeField } from "@/components/shared/CodeField";
import { dotenvLanguage } from "./dotenvLanguage";
import { mergeEnvVars, parseDotenv, serializeDotenv, withStableIds } from "./dotenv";

interface Props {
  envVars: EnvVar[];
  onChange: (updated: EnvVar[]) => void;
  onBack: () => void;
}

type Mode = "list" | "raw";

const SHOWN_SKIPPED = 3;
const DOTENV_EXTENSIONS = [dotenvLanguage];

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const modes: { value: Mode; icon: string; label: string }[] = [
    { value: "list", icon: "lucide:list", label: t("connections.envVarsPanel.modeList") },
    { value: "raw", icon: "lucide:file-code", label: ".env" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("connections.envVarsPanel.modeLabel")}
      className="flex shrink-0 rounded-lg overflow-hidden bg-(--t-bg-base) border border-(--t-border) divide-x divide-(--t-border)"
    >
      {modes.map((m) => {
        const active = m.value === mode;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m.value)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              background: active ? tint("var(--t-accent)", 15) : "transparent",
              color: active ? "var(--t-accent)" : "var(--t-text-dim)",
            }}
          >
            <Icon icon={m.icon} width={12} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function ListEditor({ envVars, onChange }: Omit<Props, "onBack">) {
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

  const pasteIntoKey = (id: string, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\n=]/.test(text)) return;
    const { vars } = parseDotenv(text);
    if (vars.length === 0) return;
    e.preventDefault();
    onChange(mergeEnvVars(envVars, vars, id));
  };

  return (
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
            onPaste={(e) => pasteIntoKey(ev.id, e)}
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
      <p className="text-xs text-(--t-text-dim) opacity-70 text-center pt-1">
        {t("connections.envVarsPanel.pasteTip")}
      </p>
    </div>
  );
}

function RawEditor({ envVars, onChange }: Omit<Props, "onBack">) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => serializeDotenv(envVars));
  const { skipped } = useMemo(() => parseDotenv(text), [text]);

  const edit = (next: string) => {
    setText(next);
    onChange(withStableIds(parseDotenv(next).vars, envVars));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 px-4 py-4">
      <p className="text-xs text-(--t-text-dim)">{t("connections.envVarsPanel.rawHint")}</p>
      <CodeField
        value={text}
        onChange={edit}
        extensions={DOTENV_EXTENSIONS}
        placeholder={"API_URL=https://example.com\nNODE_ENV=production"}
        aria-label=".env"
        minHeight="10rem"
        fill
        className="flex-1 min-h-0"
      />
      {skipped.length > 0 && (
        <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <span className="flex items-center gap-1.5 text-xs text-(--t-status-warning)">
            <Icon icon="lucide:triangle-alert" width={12} />
            {t("connections.envVarsPanel.skippedLines", { count: skipped.length })}
          </span>
          {skipped.slice(0, SHOWN_SKIPPED).map((line, i) => (
            <code key={i} className="text-[11px] font-mono text-(--t-text-dim) truncate">{line}</code>
          ))}
        </div>
      )}
    </div>
  );
}

const FOOTER_BUTTON = "text-xs px-2 py-1 rounded-md flex items-center gap-1 text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function ExportActions({ envVars }: { envVars: EnvVar[] }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyText();
  const empty = !envVars.some((e) => e.key);
  return (
    <div className="flex justify-end gap-1 px-4 pb-3 shrink-0">
      <button type="button" onClick={() => copy(serializeDotenv(envVars))} disabled={empty} className={FOOTER_BUTTON}>
        <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={12} />
        {copied ? t("connections.envVarsPanel.copied") : t("connections.envVarsPanel.copyButton")}
      </button>
      <button type="button" onClick={() => void saveTextFile(".env", `${serializeDotenv(envVars)}\n`)} disabled={empty} className={FOOTER_BUTTON}>
        <Icon icon="lucide:download" width={12} />
        {t("connections.envVarsPanel.downloadButton")}
      </button>
    </div>
  );
}

export default function EnvVarsPanel({ envVars, onChange, onBack }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("list");
  const Editor = mode === "list" ? ListEditor : RawEditor;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-(--t-bg-card)">
      <SlideOverHeader
        icon="lucide:file-terminal"
        title={t("connections.common.environmentVariables")}
        onBack={onBack}
        actions={<ModeToggle mode={mode} onChange={setMode} />}
      />
      <Editor envVars={envVars} onChange={onChange} />
      <ExportActions envVars={envVars} />
    </div>
  );
}
