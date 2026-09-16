import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorSelection, Prec, type StateCommand } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { useCmTheme } from "@/components/filetransfer/editor/useCmTheme";
import { NOTES_ICON_BUTTON, NotesEmptyState } from "./NotesChrome";
import { NotesPreview } from "./NotesPreview";
import {
  BLOCKS,
  MOD_LABEL,
  SLASH_ITEMS,
  insertBlock,
  insertLink,
  notesKeymap,
  slashCompletionSource,
  toggleLineKind,
  wrapSelection,
} from "./markdownCommands";

export type NotesMode = "preview" | "edit";

export interface NotesEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  mode: NotesMode;
  onModeChange: (mode: NotesMode) => void;
  onRunCode?: (code: string) => void;
  onBlur?: () => void;
  minHeight?: number;
}

interface ToolbarItem {
  id: string;
  icon: string;
  shortcut?: string;
  command: StateCommand;
}

const TOOLBAR: ToolbarItem[] = [
  { id: "h1", icon: "lucide:heading-1", shortcut: "Shift+1", command: toggleLineKind("h1") },
  { id: "h2", icon: "lucide:heading-2", shortcut: "Shift+2", command: toggleLineKind("h2") },
  { id: "h3", icon: "lucide:heading-3", shortcut: "Shift+3", command: toggleLineKind("h3") },
  { id: "bold", icon: "lucide:bold", shortcut: "B", command: wrapSelection("**") },
  { id: "italic", icon: "lucide:italic", shortcut: "I", command: wrapSelection("*") },
  { id: "code", icon: "lucide:code", command: wrapSelection("`") },
  { id: "link", icon: "lucide:link", shortcut: "K", command: insertLink },
  { id: "bullet", icon: "lucide:list", shortcut: "Shift+8", command: toggleLineKind("bullet") },
  { id: "ordered", icon: "lucide:list-ordered", shortcut: "Shift+7", command: toggleLineKind("ordered") },
  { id: "task", icon: "lucide:list-checks", shortcut: "Shift+9", command: toggleLineKind("task") },
  { id: "codeBlock", icon: "lucide:square-code", command: insertBlock(...BLOCKS.codeBlock) },
];

const NOTES_THEME = EditorView.theme({
  ".cm-placeholder": { color: "var(--t-text-muted)" },
});

function clampSelection(selection: EditorSelection, length: number): EditorSelection {
  const clamp = (pos: number) => Math.min(pos, length);
  return EditorSelection.create(
    selection.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head))),
    selection.mainIndex,
  );
}

function isToggleModeKey(e: React.KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e";
}

export function NotesEditor({
  value, onChange, readOnly, mode, onModeChange, onRunCode, onBlur, minHeight = 120,
}: NotesEditorProps) {
  const { t } = useTranslation();
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const focusOnSwitchRef = useRef(false);
  const requestMode = (next: NotesMode) => {
    focusOnSwitchRef.current = true;
    onModeChange(next);
  };
  const takeFocusRequest = () => {
    const requested = focusOnSwitchRef.current;
    focusOnSwitchRef.current = false;
    return requested;
  };
  const selectionRef = useRef<EditorSelection | null>(null);
  const requestModeRef = useRef(requestMode);
  requestModeRef.current = requestMode;
  const themeExt = useCmTheme();
  const effectiveMode: NotesMode = readOnly ? "preview" : mode;

  useEffect(() => {
    if (effectiveMode === "preview" && takeFocusRequest()) previewRef.current?.focus();
  }, [effectiveMode]);

  const extensions = useMemo(
    () => [
      ...themeExt,
      markdown(),
      NOTES_THEME,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => { selectionRef.current = update.state.selection; }),
      placeholder(t("notes.editor.placeholder")),
      Prec.high(keymap.of(notesKeymap(() => requestModeRef.current("preview")))),
      autocompletion({ override: [slashCompletionSource(SLASH_ITEMS, (k) => t(k))], icons: false }),
    ],
    [themeExt, t],
  );

  const runCommand = (command: StateCommand) => {
    const view = cmRef.current?.view;
    if (!view) return;
    command(view);
    view.focus();
  };

  const toolbarButton = `w-6 h-6 flex items-center justify-center ${NOTES_ICON_BUTTON}`;
  const isEmpty = !value.trim();

  return (
    <div
      data-notes-editor
      className="flex flex-col min-h-0 h-full"
      onKeyDown={(e) => {
        if (effectiveMode === "edit") {
          e.stopPropagation();
          return;
        }
        if (!readOnly && isToggleModeKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          requestMode("edit");
        }
      }}
    >
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-b-(--t-border) shrink-0">
          {effectiveMode === "edit" &&
            TOOLBAR.map((item) => (
              <button
                key={item.id}
                type="button"
                className={toolbarButton}
                title={item.shortcut ? `${t(`notes.toolbar.${item.id}`)} (${MOD_LABEL}+${item.shortcut})` : t(`notes.toolbar.${item.id}`)}
                onMouseDown={(e) => { e.preventDefault(); runCommand(item.command); }}
              >
                <Icon icon={item.icon} width={13} />
              </button>
            ))}
          <button
            type="button"
            className={`${toolbarButton} ml-auto`}
            title={`${t(effectiveMode === "edit" ? "notes.toolbar.preview" : "notes.toolbar.edit")} (${MOD_LABEL}+E)`}
            onClick={() => requestMode(effectiveMode === "edit" ? "preview" : "edit")}
          >
            <Icon icon={effectiveMode === "edit" ? "lucide:eye" : "lucide:pencil"} width={13} />
          </button>
        </div>
      )}
      <div ref={previewRef} className="flex-1 min-h-0 overflow-y-auto" style={{ minHeight }} tabIndex={effectiveMode === "preview" ? 0 : undefined}>
        {effectiveMode === "edit" ? (
          <CodeMirror
            ref={cmRef}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            extensions={extensions}
            indentWithTab={false}
            onCreateEditor={(view) => {
              if (selectionRef.current) {
                view.dispatch({ selection: clampSelection(selectionRef.current, view.state.doc.length), scrollIntoView: true });
              }
              if (takeFocusRequest()) view.focus();
            }}
            theme="none"
            height="100%"
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false }}
          />
        ) : isEmpty ? (
          <NotesEmptyState message={t("notes.empty.title")}>
            {!readOnly && (
              <button type="button" className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs font-medium" onClick={() => requestMode("edit")}>
                {t("notes.empty.start")}
              </button>
            )}
          </NotesEmptyState>
        ) : (
          <div className="px-3 py-2">
            <NotesPreview value={value} onChange={onChange} readOnly={readOnly} onRunCode={onRunCode} onRequestEdit={() => requestMode("edit")} />
          </div>
        )}
      </div>
    </div>
  );
}
