import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { pickLocalPath } from "@/services/sftp";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";
import { FormSelect } from "@/components/shared/FormSelect";
import { VariableTextarea } from "@/components/snippets/VariableTextarea";
import type { SnippetStep, Snippet } from "@/types";

interface Props {
  value: SnippetStep[];
  onChange: (steps: SnippetStep[]) => void;
  snippets: Snippet[];
  onBrowseRemote: (index: number, field: "from_path" | "to_path", isDir: boolean) => void;
}

export function StepListEditor({ value, onChange, snippets, onBrowseRemote }: Props) {
  const { t } = useTranslation();
  const update = (i: number, step: SnippetStep) => onChange(value.map((s, j) => (j === i ? step : s)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (step: SnippetStep) => onChange([...value, step]);

  return (
    <div className="flex flex-col gap-2">
      {value.map((step, i) => (
        <div key={i} className="rounded-lg border p-2 flex flex-col gap-2" style={{ borderColor: "var(--t-border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "var(--t-text-dim)" }}>
              {t(`snippets.step.kind.${step.kind}`)}
            </span>
            <div className="flex gap-1">
              <button type="button" onClick={() => move(i, -1)} aria-label={t("snippets.step.moveUp")}><Icon icon="lucide:chevron-up" width={14} /></button>
              <button type="button" onClick={() => move(i, 1)} aria-label={t("snippets.step.moveDown")}><Icon icon="lucide:chevron-down" width={14} /></button>
              <button type="button" onClick={() => remove(i)} aria-label={t("snippets.step.remove")}><Icon icon="lucide:trash-2" width={14} /></button>
            </div>
          </div>

          {step.kind === "script" && (
            <VariableTextarea
              value={step.content}
              onChange={(v) => update(i, { ...step, content: v })}
              rows={3}
            />
          )}

          {step.kind === "transfer" && (
            <div className="flex flex-col gap-2">
              {(["from", "to"] as const).map((side) => {
                const endpoint = step[side];
                const pathKey = side === "from" ? "from_path" : "to_path";
                const pathVal = side === "from" ? step.from_path : step.to_path;
                return (
                  <div key={side} className="flex items-center gap-1">
                    <span className="text-xs w-9 shrink-0" style={{ color: "var(--t-text-dim)" }}>
                      {t(`snippets.step.${side}`)}
                    </span>
                    <div className="w-28 shrink-0">
                      <FormSelect
                        value={endpoint}
                        onChange={(v) => update(i, { ...step, [side]: v as "local" | "remote" })}
                        options={[
                          { value: "local", label: t("snippets.step.endpoint.local") },
                          { value: "remote", label: t("snippets.step.endpoint.remote") },
                        ]}
                      />
                    </div>
                    <input
                      value={pathVal}
                      onChange={(e) => update(i, { ...step, [pathKey]: e.target.value })}
                      placeholder={endpoint === "local" ? t("snippets.step.localPath") : t("snippets.step.remotePath")}
                      className={formInputClass}
                      style={formInputStyle}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (endpoint === "local") {
                          const p = await pickLocalPath({ directory: step.is_dir });
                          if (p) update(i, { ...step, [pathKey]: p });
                        } else {
                          onBrowseRemote(i, pathKey, step.is_dir);
                        }
                      }}
                      className="text-xs px-2 rounded-md border shrink-0"
                      style={{ borderColor: "var(--t-border)" }}
                    >
                      {t("snippets.step.browse")}
                    </button>
                  </div>
                );
              })}
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  type="button"
                  onClick={() => update(i, { ...step, is_dir: !step.is_dir })}
                  className="text-xs px-2 py-1 rounded-md border"
                  style={{ borderColor: "var(--t-border)" }}
                >
                  {step.is_dir ? t("snippets.step.folder") : t("snippets.step.file")}
                </button>
                <button
                  type="button"
                  onClick={() => update(i, { ...step, mode: step.mode === "copy" ? "move" : "copy" })}
                  className="text-xs px-2 py-1 rounded-md border"
                  style={{ borderColor: "var(--t-border)" }}
                >
                  {t(`snippets.step.mode.${step.mode}`)}
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>{t("snippets.step.conflict.label")}</span>
                  <div className="w-32">
                    <FormSelect
                      value={step.on_conflict}
                      onChange={(v) => update(i, { ...step, on_conflict: v as typeof step.on_conflict })}
                      options={[
                        { value: "overwrite", label: t("snippets.step.conflict.overwrite") },
                        { value: "skip", label: t("snippets.step.conflict.skip") },
                        { value: "fail", label: t("snippets.step.conflict.fail") },
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step.kind === "snippet" && (
            <FormSelect
              value={step.snippet_id}
              onChange={(v) => update(i, { ...step, snippet_id: v })}
              options={[
                { value: "", label: t("snippets.step.selectSnippet") },
                ...snippets.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <button type="button" onClick={() => add({ kind: "script", content: "" })} className="text-xs px-2 py-1 rounded-md border" style={{ borderColor: "var(--t-border)" }}>{t("snippets.step.addScript")}</button>
        <button type="button" onClick={() => add({ kind: "transfer", from: "local", to: "remote", from_path: "", to_path: "", is_dir: false, mode: "copy", on_conflict: "overwrite" })} className="text-xs px-2 py-1 rounded-md border" style={{ borderColor: "var(--t-border)" }}>{t("snippets.step.addTransfer")}</button>
        <button type="button" onClick={() => add({ kind: "snippet", snippet_id: "" })} className="text-xs px-2 py-1 rounded-md border" style={{ borderColor: "var(--t-border)" }}>{t("snippets.step.addSnippet")}</button>
      </div>
    </div>
  );
}
