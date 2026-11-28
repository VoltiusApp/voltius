import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { primaryModifier } from "@/utils/primaryModifier";

export type FindOption = "caseSensitive" | "wholeWord" | "regex";

export interface FindReplace {
  value: string;
  onChange: (value: string) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
}

export interface FindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  onToggle: (option: FindOption) => void;
  resultIndex: number;
  resultCount: number;
  invalidRegex: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Bumped to refocus and select the query while the bar is already open. */
  focusTick: number;
  replace?: FindReplace;
  /** Keys the bar does not handle itself; return true when consumed. */
  onOtherKey?: (e: KeyboardEvent) => boolean;
  inputAttributes?: Record<string, string>;
}

const TOGGLE_KEYS: Record<string, FindOption> = { c: "caseSensitive", w: "wholeWord", r: "regex" };

export function FindBar(props: FindBarProps) {
  const { query, caseSensitive, wholeWord, regex, onToggle, resultIndex, resultCount, invalidRegex, replace } = props;
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [props.focusTick]);

  const hasQuery = query.length > 0;
  const showError = invalidRegex || (hasQuery && resultCount === 0);
  const counter = !hasQuery
    ? ""
    : invalidRegex
      ? t("terminal.search.invalid")
      : resultCount === 0
        ? t("terminal.search.noResults")
        : resultIndex < 0
          ? String(resultCount)
          : t("terminal.search.resultCounter", { index: resultIndex + 1, count: resultCount });

  function sharedKeys(e: React.KeyboardEvent<HTMLInputElement>): boolean {
    if (e.key === "Escape") {
      props.onClose();
      return true;
    }
    const option = e.altKey && !e.ctrlKey && !e.metaKey ? TOGGLE_KEYS[e.key.toLowerCase()] : undefined;
    if (option) {
      onToggle(option);
      return true;
    }
    return props.onOtherKey?.(e.nativeEvent) ?? false;
  }

  function onFindKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (e.shiftKey) props.onPrev();
      else props.onNext();
      e.preventDefault();
      return;
    }
    if (sharedKeys(e)) e.preventDefault();
  }

  function onReplaceKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && replace) {
      if (primaryModifier(e) && e.altKey) replace.onReplaceAll();
      else replace.onReplace();
      e.preventDefault();
      return;
    }
    if (sharedKeys(e)) e.preventDefault();
  }

  return (
    <div
      className="surface-float absolute top-2 right-2 z-30 flex flex-col gap-1 animate-fadeIn"
      style={{ padding: "5px 6px", width: "min(420px, calc(100% - 16px))" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        {replace ? (
          <IconButton
            title={t("terminal.search.toggleReplace")}
            icon={replaceOpen ? "lucide:chevron-down" : "lucide:chevron-right"}
            onClick={() => setReplaceOpen((open) => !open)}
          />
        ) : (
          <Icon icon="lucide:search" width={13} className="shrink-0 ml-1.5 mr-0.5" style={{ color: "var(--t-text-dim)" }} />
        )}

        <div className="relative flex-1 min-w-0">
          <input
            {...props.inputAttributes}
            ref={inputRef}
            value={query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            onKeyDown={onFindKey}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("terminal.search.placeholder")}
            className="w-full bg-transparent text-sm outline-hidden px-1 py-1 text-(--t-text-primary) placeholder-(--t-text-muted)"
            style={{ boxShadow: showError ? "inset 2px 0 0 var(--t-status-error, #ef4444)" : undefined }}
          />
        </div>

        <span
          className="text-xs tabular-nums whitespace-nowrap px-1.5 select-none"
          style={{ color: showError ? "var(--t-status-error, #ef4444)" : "var(--t-text-dim)" }}
        >
          {counter}
        </span>

        <div className="flex items-center gap-0.5 pl-1 ml-0.5" style={{ borderLeft: "1px solid var(--t-border)" }}>
          <ToggleChip active={caseSensitive} title={t("terminal.search.matchCase")} onClick={() => onToggle("caseSensitive")}>
            <span className="font-semibold" style={{ fontSize: "11px", letterSpacing: "-0.5px" }}>Aa</span>
          </ToggleChip>
          <ToggleChip active={wholeWord} title={t("terminal.search.matchWholeWord")} onClick={() => onToggle("wholeWord")}>
            <span
              className="font-semibold"
              style={{ fontSize: "11px", letterSpacing: "-0.5px", borderBottom: "1.5px solid currentColor", paddingBottom: 0, lineHeight: 1 }}
            >
              ab
            </span>
          </ToggleChip>
          <ToggleChip active={regex} title={t("terminal.search.useRegex")} onClick={() => onToggle("regex")}>
            <span className="font-semibold" style={{ fontSize: "11px", letterSpacing: "-0.5px" }}>.*</span>
          </ToggleChip>
        </div>

        <div className="flex items-center gap-0.5 pl-0.5">
          <IconButton title={t("terminal.search.previousMatch")} icon="lucide:chevron-up" disabled={!hasQuery || resultCount === 0} onClick={props.onPrev} />
          <IconButton title={t("terminal.search.nextMatch")} icon="lucide:chevron-down" disabled={!hasQuery || resultCount === 0} onClick={props.onNext} />
          <IconButton title={t("terminal.search.closeTitle")} icon="lucide:x" onClick={props.onClose} />
        </div>
      </div>

      {replace && replaceOpen && (
        <div className="flex items-center gap-1">
          <span className="shrink-0" style={{ width: "22px" }} />
          <input
            value={replace.value}
            onChange={(e) => replace.onChange(e.target.value)}
            onKeyDown={onReplaceKey}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("terminal.search.replacePlaceholder")}
            className="flex-1 min-w-0 bg-transparent text-sm outline-hidden px-1 py-1 text-(--t-text-primary) placeholder-(--t-text-muted)"
          />
          <div className="flex items-center gap-0.5 pl-1 ml-0.5" style={{ borderLeft: "1px solid var(--t-border)" }}>
            <IconButton title={t("terminal.search.replace")} icon="lucide:replace" disabled={!hasQuery || resultCount === 0} onClick={replace.onReplace} />
            <IconButton title={t("terminal.search.replaceAll")} icon="lucide:replace-all" disabled={!hasQuery || resultCount === 0} onClick={replace.onReplaceAll} />
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleChip({ active, title, onClick, children }: { active: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className="rounded-sm transition-colors flex items-center justify-center select-none"
      style={{
        width: "22px",
        height: "22px",
        background: active ? "var(--t-accent)" : "transparent",
        color: active ? "var(--t-bg-terminal)" : "var(--t-text-dim)",
        border: active ? "1px solid var(--t-accent)" : "1px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.background = "var(--t-bg-elevated)";
        e.currentTarget.style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--t-text-dim)";
      }}
    >
      {children}
    </button>
  );
}

function IconButton({ icon, title, onClick, disabled }: { icon: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      className="rounded-sm transition-colors flex items-center justify-center shrink-0"
      style={{
        width: "22px",
        height: "22px",
        background: "transparent",
        color: "var(--t-text-dim)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--t-bg-elevated)";
        e.currentTarget.style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--t-text-dim)";
      }}
    >
      <Icon icon={icon} width={14} />
    </button>
  );
}
