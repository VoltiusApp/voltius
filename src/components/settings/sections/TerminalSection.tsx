import { useTranslation } from "react-i18next";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { SettingRow } from "./shared";

export default function TerminalSection() {
  const { t } = useTranslation();
  const [scrollMinimapEnabled, setScrollMinimapEnabled] = useToggle("scroll-minimap");
  const [selectToCopy, setSelectToCopy] = useToggle("select-to-copy");
  const [ignoreBracketedPaste, setIgnoreBracketedPaste] = useToggle("ignore-bracketed-paste");
  const scrollbackLines = useTerminalSettingsStore((s) => s.scrollbackLines);
  const setScrollbackLines = useTerminalSettingsStore((s) => s.setScrollbackLines);

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
          title={t("settings.terminal.minimap.title")}
          desc={t("settings.terminal.minimap.desc")}
          dirty={scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default}
          onReset={() => setScrollMinimapEnabled(TOGGLE_DEFS["scroll-minimap"].default)}
        >
          <Toggle checked={scrollMinimapEnabled} onChange={setScrollMinimapEnabled} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.selectToCopy.title")}
          desc={t("settings.terminal.selectToCopy.desc")}
          dirty={selectToCopy !== TOGGLE_DEFS["select-to-copy"].default}
          onReset={() => setSelectToCopy(TOGGLE_DEFS["select-to-copy"].default)}
        >
          <Toggle checked={selectToCopy} onChange={setSelectToCopy} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.ignoreBracketedPaste.title")}
          desc={t("settings.terminal.ignoreBracketedPaste.desc")}
          dirty={ignoreBracketedPaste !== TOGGLE_DEFS["ignore-bracketed-paste"].default}
          onReset={() => setIgnoreBracketedPaste(TOGGLE_DEFS["ignore-bracketed-paste"].default)}
        >
          <Toggle checked={ignoreBracketedPaste} onChange={setIgnoreBracketedPaste} />
        </SettingRow>
      </div>
    </div>
  );
}
