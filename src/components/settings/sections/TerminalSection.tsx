import { useTranslation } from "react-i18next";
import { CURSOR_STYLES, DEFAULT_CURSOR_STYLE, useTerminalSettingsStore, type TerminalCursorStyle } from "@/stores/terminalSettingsStore";
import { TOGGLE_DEFS, useToggle, type ToggleId } from "@/stores/toggleSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { DEFAULT_KEYWORD_RULES, sameKeywordRules } from "@/utils/keywordMatcher";
import { KeywordRulesEditor } from "./KeywordRulesEditor";
import { SettingRow } from "./shared";
import { useIsAndroid, useIsMobile } from "@/utils/platform";
import { MOBILE_HIDDEN_TOGGLES } from "@/components/settings/settingsMobileCore";

function ToggleCard({ id, i18nKey }: { id: ToggleId; i18nKey: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useToggle(id);
  const fallback = TOGGLE_DEFS[id].default;
  const isMobile = useIsMobile();
  if (isMobile && MOBILE_HIDDEN_TOGGLES.has(id)) return null;
  return (
    <SettingRow
      variant="card"
      className="mt-4"
      syncKey={`appSettings.toggles.${id}`}
      title={t(`settings.terminal.${i18nKey}.title`)}
      desc={t(`settings.terminal.${i18nKey}.desc`)}
      dirty={value !== fallback}
      onReset={() => setValue(fallback)}
    >
      <Toggle checked={value} onChange={setValue} />
    </SettingRow>
  );
}

export default function TerminalSection() {
  const { t } = useTranslation();
  const isAndroid = useIsAndroid();
  const scrollbackLines = useTerminalSettingsStore((s) => s.scrollbackLines);
  const setScrollbackLines = useTerminalSettingsStore((s) => s.setScrollbackLines);
  const cursorStyle = useTerminalSettingsStore((s) => s.cursorStyle);
  const setCursorStyle = useTerminalSettingsStore((s) => s.setCursorStyle);
  const [keywordHighlight, setKeywordHighlight] = useToggle("keyword-highlight");
  const keywordRules = useTerminalSettingsStore((s) => s.keywordRules);
  const setKeywordRules = useTerminalSettingsStore((s) => s.setKeywordRules);
  const keywordDefault = TOGGLE_DEFS["keyword-highlight"].default;
  const keywordDirty = keywordHighlight !== keywordDefault || !sameKeywordRules(keywordRules, DEFAULT_KEYWORD_RULES);

  const scrollbackOptions = [1_000, 10_000, 50_000, 100_000, 250_000]
    .filter((value) => value >= MIN_SCROLLBACK_LINES && value <= MAX_SCROLLBACK_LINES)
    .map((value) => ({ value: String(value), label: t("settings.terminal.scrollback.option", { count: value }) }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
          {t("settings.terminal.heading")}
        </h3>
        <SettingRow
          variant="card"
          title={t("settings.terminal.scrollback.title")}
          desc={t("settings.terminal.scrollback.desc")}
          dirty={scrollbackLines !== DEFAULT_SCROLLBACK_LINES}
          onReset={() => setScrollbackLines(DEFAULT_SCROLLBACK_LINES)}
        >
          <FormSelect
            className="w-44 shrink-0"
            value={String(scrollbackLines)}
            options={scrollbackOptions}
            onChange={(value) => setScrollbackLines(Number(value))}
          />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          syncKey="appSettings.terminal.cursorStyle"
          title={t("settings.terminal.cursorStyle.title")}
          desc={t("settings.terminal.cursorStyle.desc")}
          dirty={cursorStyle !== DEFAULT_CURSOR_STYLE}
          onReset={() => setCursorStyle(DEFAULT_CURSOR_STYLE)}
        >
          <FormSelect
            className="w-44 shrink-0"
            value={cursorStyle}
            options={CURSOR_STYLES.map((value) => ({ value, label: t(`settings.terminal.cursorStyle.${value}`) }))}
            onChange={(value) => setCursorStyle(value as TerminalCursorStyle)}
          />
        </SettingRow>
        <ToggleCard id="cursor-blink" i18nKey="cursorBlink" />
        <ToggleCard id="scroll-minimap" i18nKey="minimap" />
        <ToggleCard id="select-to-copy" i18nKey="selectToCopy" />
        <ToggleCard id="drag-selects-text" i18nKey="dragSelectsText" />
        <ToggleCard id="ignore-bracketed-paste" i18nKey="ignoreBracketedPaste" />
        <ToggleCard id="paste-image-as-path" i18nKey="pasteImageAsPath" />
        {isAndroid && <ToggleCard id="volume-down-ctrl" i18nKey="volumeDownCtrl" />}
        <SettingRow
          variant="card"
          className="mt-4"
          syncKey="appSettings.toggles.keyword-highlight"
          title={t("settings.terminal.keywordHighlight.title")}
          desc={t("settings.terminal.keywordHighlight.desc")}
          dirty={keywordDirty}
          onReset={() => {
            setKeywordHighlight(keywordDefault);
            setKeywordRules(DEFAULT_KEYWORD_RULES);
          }}
        >
          <Toggle checked={keywordHighlight} onChange={setKeywordHighlight} />
        </SettingRow>
        {keywordHighlight && <KeywordRulesEditor />}
      </div>
    </div>
  );
}
