import { useTranslation } from "react-i18next";
import { useToggle } from "@/stores/toggleSettingsStore";
import { Setting } from "@/components/settings/Setting";
import { KeywordRulesEditor } from "./KeywordRulesEditor";

const TERMINAL_ROWS = [
  "terminal.cursorStyle",
  "toggles.cursor-blink",
  "toggles.scroll-minimap",
  "toggles.select-to-copy",
  "toggles.drag-selects-text",
  "toggles.ignore-bracketed-paste",
  "toggles.paste-image-as-path",
  "toggles.command-history",
  "toggles.volume-down-ctrl",
  "toggles.keyword-highlight",
];

export default function TerminalSection() {
  const { t } = useTranslation();
  const [keywordHighlight] = useToggle("keyword-highlight");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
          {t("settings.terminal.heading")}
        </h3>
        <Setting id="terminal.scrollbackLines" variant="card" />
        {TERMINAL_ROWS.map((id) => <Setting key={id} id={id} variant="card" className="mt-4" />)}
        {keywordHighlight && <KeywordRulesEditor />}
      </div>
    </div>
  );
}
