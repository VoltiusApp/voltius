import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { ChipInput } from "@/components/shared/ChipInput";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { Toggle } from "@/components/shared/Toggle";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { ANSI_SLOTS, MAX_KEYWORD_RULES, type AnsiSlot, type KeywordRule } from "@/utils/keywordMatcher";

const K = "settings.terminal.keywordHighlight";
const NEW_RULE_COLORS: AnsiSlot[] = ["red", "yellow", "green", "blue", "magenta", "cyan"];

const useSlotColor = (slot: AnsiSlot) => useThemeStore((s) => s.getActiveTheme().terminal[slot]);

function Swatch({ slot, className }: { slot: AnsiSlot; className: string }) {
  return <span className={className} style={{ background: useSlotColor(slot) }} />;
}

function WordChip({ slot, children }: { slot: AnsiSlot; children: ReactNode }) {
  return (
    <span
      className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border border-(--t-border) bg-(--t-bg-terminal)"
      style={{ color: useSlotColor(slot) }}
    >
      {children}
    </span>
  );
}

function RuleRow({ rule, onChange, onDelete }: {
  rule: KeywordRule;
  onChange: (next: KeywordRule) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [picking, setPicking] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);

  return (
    <div data-testid="keyword-rule" className="flex items-start gap-2">
      <button
        ref={swatchRef}
        type="button"
        aria-label={`${t(`${K}.color`)}: ${t(`themeCreator.fields.${rule.color}`)}`}
        aria-haspopup="listbox"
        aria-expanded={picking}
        onClick={() => setPicking((open) => !open)}
        className="mt-1.5 shrink-0 rounded-md p-1 border border-(--t-border) hover:border-(--t-border-hover) transition-colors"
      >
        <Swatch slot={rule.color} className="block w-4 h-4 rounded-sm" />
      </button>
      <PickerSurface open={picking} onClose={() => setPicking(false)} anchorRef={swatchRef} title={t(`${K}.color`)} width="content">
        <div role="listbox" aria-label={t(`${K}.color`)} className="grid grid-cols-8 gap-1.5 p-2">
          {ANSI_SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              role="option"
              aria-selected={slot === rule.color}
              aria-label={t(`themeCreator.fields.${slot}`)}
              onClick={() => {
                onChange({ ...rule, color: slot });
                setPicking(false);
              }}
              className={`rounded-md p-1 border transition-colors ${slot === rule.color ? "border-(--t-accent)" : "border-transparent hover:border-(--t-border-hover)"}`}
            >
              <Swatch slot={slot} className="block w-5 h-5 rounded-sm" />
            </button>
          ))}
        </div>
      </PickerSurface>
      <div className="flex-1 min-w-0">
        <ChipInput
          value={rule.words}
          input={input}
          onInputChange={setInput}
          onAdd={(word) => {
            onChange({ ...rule, words: [...rule.words, word] });
            setInput("");
          }}
          onRemove={(word) => onChange({ ...rule, words: rule.words.filter((w) => w !== word) })}
          renderChip={(word, children) => <WordChip key={word} slot={rule.color}>{children}</WordChip>}
          removeLabel={(word) => t(`${K}.removeWord`, { word })}
          placeholder={t(`${K}.wordsPlaceholder`)}
          ariaLabel={t(`${K}.wordsPlaceholder`)}
        />
      </div>
      <div className="flex items-center gap-2 shrink-0 mt-2">
        <Toggle checked={rule.enabled} onChange={(enabled) => onChange({ ...rule, enabled })} aria-label={t(`${K}.ruleEnabled`)} />
        <button
          type="button"
          onClick={onDelete}
          aria-label={t(`${K}.deleteRule`)}
          className="p-1 rounded-md text-(--t-text-dim) hover:text-(--t-status-error) transition-colors"
        >
          <Icon icon="lucide:trash-2" width={14} />
        </button>
      </div>
    </div>
  );
}

export function KeywordRulesEditor() {
  const { t } = useTranslation();
  const rules = useTerminalSettingsStore((s) => s.keywordRules);
  const setRules = useTerminalSettingsStore((s) => s.setKeywordRules);

  const addRule = () => {
    const color = NEW_RULE_COLORS.find((slot) => !rules.some((rule) => rule.color === slot)) ?? "blue";
    setRules([...rules, { id: crypto.randomUUID(), color, words: [], enabled: true }]);
  };

  return (
    <div className="mt-2 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 space-y-3">
      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          onChange={(next) => setRules(rules.map((r) => (r.id === next.id ? next : r)))}
          onDelete={() => setRules(rules.filter((r) => r.id !== rule.id))}
        />
      ))}
      <button
        type="button"
        disabled={rules.length >= MAX_KEYWORD_RULES}
        onClick={addRule}
        className="flex items-center gap-1.5 text-xs text-(--t-text-secondary) hover:text-(--t-text-primary) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Icon icon="lucide:plus" width={12} />
        {t(`${K}.addRule`)}
      </button>
    </div>
  );
}
