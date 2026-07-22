import { useTranslation } from "react-i18next";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { DirtyDot, ResetButton } from "./shared";

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
        <div className="group rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.terminal.scrollback.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.terminal.scrollback.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scrollbackLines !== DEFAULT_SCROLLBACK_LINES && (
              <ResetButton onReset={() => setScrollbackLines(DEFAULT_SCROLLBACK_LINES)} />
            )}
            {scrollbackLines !== DEFAULT_SCROLLBACK_LINES && <DirtyDot />}
            <FormSelect
              className="w-44 shrink-0"
              value={String(scrollbackLines)}
              options={scrollbackOptions}
              onChange={(value) => setScrollbackLines(Number(value))}
            />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.terminal.minimap.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.terminal.minimap.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default && (
              <ResetButton onReset={() => setScrollMinimapEnabled(TOGGLE_DEFS["scroll-minimap"].default)} />
            )}
            {scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default && <DirtyDot />}
            <Toggle checked={scrollMinimapEnabled} onChange={setScrollMinimapEnabled} />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.terminal.selectToCopy.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.terminal.selectToCopy.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {selectToCopy !== TOGGLE_DEFS["select-to-copy"].default && (
              <ResetButton onReset={() => setSelectToCopy(TOGGLE_DEFS["select-to-copy"].default)} />
            )}
            {selectToCopy !== TOGGLE_DEFS["select-to-copy"].default && <DirtyDot />}
            <Toggle checked={selectToCopy} onChange={setSelectToCopy} />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.terminal.ignoreBracketedPaste.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.terminal.ignoreBracketedPaste.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ignoreBracketedPaste !== TOGGLE_DEFS["ignore-bracketed-paste"].default && (
              <ResetButton onReset={() => setIgnoreBracketedPaste(TOGGLE_DEFS["ignore-bracketed-paste"].default)} />
            )}
            {ignoreBracketedPaste !== TOGGLE_DEFS["ignore-bracketed-paste"].default && <DirtyDot />}
            <Toggle checked={ignoreBracketedPaste} onChange={setIgnoreBracketedPaste} />
          </div>
        </div>
      </div>
    </div>
  );
}
