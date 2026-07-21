import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { pickLocalPath } from "@/services/sftp";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";
import { FormSelect } from "@/components/shared/FormSelect";
import { VariableTextarea } from "@/components/snippets/VariableTextarea";
import { useListReorder } from "@/hooks/useListReorder";
import type { SnippetStep, Snippet } from "@/types";

interface Props {
  value: SnippetStep[];
  onChange: (steps: SnippetStep[]) => void;
  snippets: Snippet[];
  onBrowseRemote: (index: number, field: "from_path" | "to_path", isDir: boolean) => void;
}

const KIND_META: Record<SnippetStep["kind"], { icon: string }> = {
  script:   { icon: "lucide:braces" },
  transfer: { icon: "lucide:arrow-left-right" },
  snippet:  { icon: "lucide:link" },
};

const ADD_DEFS = [
  { kind: "script",   icon: "lucide:braces",          make: (): SnippetStep => ({ kind: "script", content: "" }) },
  { kind: "transfer", icon: "lucide:arrow-left-right", make: (): SnippetStep => ({ kind: "transfer", from: "local", to: "remote", from_path: "", to_path: "", is_dir: false, mode: "copy", on_conflict: "overwrite" }) },
  { kind: "snippet",  icon: "lucide:link",            make: (): SnippetStep => ({ kind: "snippet", snippet_id: "" }) },
] as const;

export function StepListEditor({ value, onChange, snippets, onBrowseRemote }: Props) {
  const { t } = useTranslation();
  const update = (i: number, step: SnippetStep) => onChange(value.map((s, j) => (j === i ? step : s)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = (step: SnippetStep) => onChange([...value, step]);

  // Steps have no id of their own; keep a parallel id list so the reorder hook
  // can key rows by identity across moves.
  const idsRef = useRef<string[]>([]);
  while (idsRef.current.length < value.length) idsRef.current.push(crypto.randomUUID());
  if (idsRef.current.length > value.length) idsRef.current.length = value.length;
  const rows = value.map((step, i) => ({ id: idsRef.current[i], step, i }));

  const dnd = useListReorder(rows, (next) => {
    idsRef.current = next.map((r) => r.id);
    onChange(next.map((r) => r.step));
  });

  return (
    <div className="flex flex-col gap-2" {...dnd.containerProps}>
      {rows.map(({ id, step, i }) => {
        const { isDragging, isOver, pos } = dnd.rowState(id);
        return (
          <div
            key={id}
            {...dnd.rowProps(id)}
            className="rounded-lg border bg-(--t-bg-elevated)"
            style={{
              borderColor: "var(--t-border)",
              opacity: isDragging ? 0.4 : 1,
              borderTopColor: isOver && pos === "before" ? "var(--t-accent)" : undefined,
              borderBottomColor: isOver && pos === "after" ? "var(--t-accent)" : undefined,
              cursor: dnd.dragging ? "grabbing" : undefined,
              userSelect: "none",
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-b-(--t-border)">
              <div
                {...dnd.handleProps(id)}
                className="text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors shrink-0 cursor-grab active:cursor-grabbing"
                aria-label={t("snippets.step.dragToReorder")}
              >
                <Icon icon="lucide:grip-vertical" width={14} />
              </div>
              <span className="w-5 h-5 rounded-full bg-(--t-accent) text-(--t-bg-card) text-[10px] font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <Icon icon={KIND_META[step.kind].icon} width={14} className="text-(--t-accent) shrink-0" />
              <span className="text-xs font-semibold flex-1 text-(--t-text-primary)">{t(`snippets.step.kind.${step.kind}`)}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={t("snippets.step.remove")}
                className="text-(--t-text-dim) hover:text-red-400 transition-colors shrink-0"
              >
                <Icon icon="lucide:trash-2" width={14} />
              </button>
            </div>

            {/* Body */}
            <div className="p-2.5">
              {step.kind === "script" && (
                <VariableTextarea value={step.content} onChange={(v) => update(i, { ...step, content: v })} rows={3} />
              )}

              {step.kind === "transfer" && (
                <div className="flex flex-col gap-2.5">
                  {(["from", "to"] as const).map((side, sIdx) => {
                    const endpoint = step[side];
                    const pathKey = side === "from" ? "from_path" : "to_path";
                    const pathVal = side === "from" ? step.from_path : step.to_path;
                    return (
                      <div key={side}>
                        {sIdx === 1 && (
                          <div className="flex justify-center -mt-1 mb-1 text-(--t-text-dim)">
                            <Icon icon="lucide:arrow-down" width={14} />
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs w-9 shrink-0 font-medium" style={{ color: "var(--t-text-dim)" }}>
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
                            className={`${formInputClass} font-mono`}
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
                            aria-label={t("snippets.step.browse")}
                            className="w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
                            style={{ borderColor: "var(--t-border)" }}
                          >
                            <Icon icon="lucide:folder-open" width={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex gap-2 flex-wrap items-center pt-0.5">
                    <button
                      type="button"
                      onClick={() => update(i, { ...step, is_dir: !step.is_dir })}
                      className="text-xs px-2.5 py-1 rounded-md border"
                      style={{ borderColor: "var(--t-border)" }}
                    >
                      {step.is_dir ? t("snippets.step.folder") : t("snippets.step.file")}
                    </button>
                    <button
                      type="button"
                      onClick={() => update(i, { ...step, mode: step.mode === "copy" ? "move" : "copy" })}
                      className="text-xs px-2.5 py-1 rounded-md border"
                      style={{ borderColor: "var(--t-border)" }}
                    >
                      {t(`snippets.step.mode.${step.mode}`)}
                    </button>
                    <div className="flex items-center gap-1.5 ml-auto">
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
          </div>
        );
      })}

      <div className="flex gap-2">
        {ADD_DEFS.map((b) => (
          <button
            key={b.kind}
            type="button"
            onClick={() => add(b.make())}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
            style={{ borderColor: "var(--t-border)" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--t-border-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
          >
            <Icon icon={b.icon} width={13} />
            {t(`snippets.step.kind.${b.kind}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
