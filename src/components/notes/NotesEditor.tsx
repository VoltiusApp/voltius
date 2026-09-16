import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap, placeholder, tooltips } from "@codemirror/view";
import { EditorSelection, Prec, type StateCommand } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { useCmTheme } from "@/components/filetransfer/editor/useCmTheme";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { MenuItemList } from "@/components/shared/ContextMenu";
import { useIsAndroid } from "@/utils/platform";
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

interface ToolbarMenuEntry {
  id: string;
  icon: string;
  align: "left" | "right";
  items: ToolbarItem[];
}

const TOOLBAR: (ToolbarItem | ToolbarMenuEntry)[] = [
  {
    id: "heading",
    icon: "lucide:heading",
    align: "left",
    items: [
      { id: "h1", icon: "lucide:heading-1", shortcut: "Shift+1", command: toggleLineKind("h1") },
      { id: "h2", icon: "lucide:heading-2", shortcut: "Shift+2", command: toggleLineKind("h2") },
      { id: "h3", icon: "lucide:heading-3", shortcut: "Shift+3", command: toggleLineKind("h3") },
    ],
  },
  { id: "bold", icon: "lucide:bold", shortcut: "B", command: wrapSelection("**") },
  { id: "italic", icon: "lucide:italic", shortcut: "I", command: wrapSelection("*") },
  { id: "link", icon: "lucide:link", shortcut: "K", command: insertLink },
  { id: "bullet", icon: "lucide:list", shortcut: "Shift+8", command: toggleLineKind("bullet") },
  { id: "ordered", icon: "lucide:list-ordered", shortcut: "Shift+7", command: toggleLineKind("ordered") },
  { id: "task", icon: "lucide:list-checks", shortcut: "Shift+9", command: toggleLineKind("task") },
  {
    id: "more",
    icon: "lucide:ellipsis",
    align: "right",
    items: [
      { id: "code", icon: "lucide:code", command: wrapSelection("`") },
      { id: "codeBlock", icon: "lucide:square-code", command: insertBlock(...BLOCKS.codeBlock) },
    ],
  },
];

const shortcutLabel = (shortcut: string) => `${MOD_LABEL}+${shortcut}`;

const keepEditorFocus = (e: MouseEvent) => e.preventDefault();

function ToolbarMenu({ menu, className, onRun }: { menu: ToolbarMenuEntry; className: string; onRun: (command: StateCommand) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const label = t(`notes.toolbar.${menu.id}`);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={className}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={keepEditorFocus}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={menu.icon} width={13} />
      </button>
      <PickerSurface open={open} onClose={close} anchorRef={anchorRef} title={label} width="content" minWidth="12.667rem" align={menu.align}>
        <div onMouseDown={keepEditorFocus}>
          <MenuItemList
            items={menu.items.map((item) => ({
              label: t(`notes.toolbar.${item.id}`),
              icon: item.icon,
              shortcut: item.shortcut && shortcutLabel(item.shortcut),
              onClick: () => onRun(item.command),
            }))}
            onClose={close}
          />
        </div>
      </PickerSurface>
    </>
  );
}

const NOTES_THEME = EditorView.theme({
  ".cm-placeholder": { color: "var(--t-text-muted)" },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "var(--t-bg-card)",
    border: "none",
    borderRadius: "var(--r-md)",
    boxShadow: "var(--t-ring), var(--t-elev-2)",
    padding: "0.375rem",
    "& > ul": { fontFamily: "inherit", minWidth: "12.667rem", maxHeight: "320px" },
    "& > ul > li": {
      padding: "0.5rem 0.75rem",
      borderRadius: "0.5rem",
      fontSize: "0.75rem",
      lineHeight: "1rem",
      color: "var(--t-text-secondary)",
    },
    "& > ul > li:hover, & > ul > li[aria-selected]": {
      background: "var(--t-bg-card-hover)",
      color: "var(--t-text-primary)",
    },
  },
  ".cm-completionMatchedText": { textDecoration: "none" },
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
  const touch = useIsAndroid();
  const effectiveMode: NotesMode = readOnly ? "preview" : mode;

  useEffect(() => {
    if (effectiveMode === "preview" && takeFocusRequest()) previewRef.current?.focus();
  }, [effectiveMode]);

  const extensions = useMemo(
    () => [
      ...themeExt,
      markdown(),
      NOTES_THEME,
      tooltips({ position: "fixed", parent: document.body }),
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

  const toolbarButton = `${touch ? "size-[36px]" : "w-6 h-6"} shrink-0 flex items-center justify-center ${NOTES_ICON_BUTTON}`;
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
        <div className="flex items-center gap-0.5 px-1.5 border-b border-b-(--t-border) shrink-0">
          <div className="flex flex-1 min-w-0 items-center gap-0.5 py-1 overflow-x-auto">
            {effectiveMode === "edit" &&
              TOOLBAR.map((item) => "items" in item ? (
                <ToolbarMenu key={item.id} menu={item} className={toolbarButton} onRun={runCommand} />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  className={toolbarButton}
                  title={item.shortcut ? `${t(`notes.toolbar.${item.id}`)} (${shortcutLabel(item.shortcut)})` : t(`notes.toolbar.${item.id}`)}
                  onMouseDown={(e) => { keepEditorFocus(e); runCommand(item.command); }}
                >
                  <Icon icon={item.icon} width={13} />
                </button>
              ))}
          </div>
          <button
            type="button"
            className={`${toolbarButton} my-1`}
            title={`${t(effectiveMode === "edit" ? "notes.toolbar.preview" : "notes.toolbar.edit")} (${shortcutLabel("E")})`}
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
