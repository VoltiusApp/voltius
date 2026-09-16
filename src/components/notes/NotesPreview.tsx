import { createContext, useContext, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeClipboard } from "@/utils/clipboard";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { isAllowedLinkHref, toggleTaskAtLine } from "./notesText";

export interface NotesPreviewProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onRunCode?: (code: string) => void;
  onRequestEdit?: () => void;
}

interface HastNode { type: string; value?: string; children?: HastNode[] }

const TaskLineContext = createContext<number | null>(null);

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function SafeLink({ href, children }: { href?: string | null; children: ReactNode }) {
  if (!isAllowedLinkHref(href)) return <span>{children}</span>;
  return (
    <a
      href={href}
      className="text-(--t-accent) underline underline-offset-2"
      onClick={(e) => { e.preventDefault(); void openUrl(href); }}
    >
      {children}
    </a>
  );
}

function CodeBlock({ code, children, onRunCode }: { code: string; children: ReactNode; onRunCode?: (code: string) => void }) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(1500);
  const button = "p-1 rounded-sm text-(--t-text-muted) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)";
  return (
    <div className="group relative my-2">
      <pre className="overflow-x-auto rounded-md bg-(--t-bg-card) border border-(--t-border) p-2 text-xs font-mono">{children}</pre>
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          className={button}
          title={t(copied ? "notes.code.copied" : "notes.code.copy")}
          onClick={() => { void writeClipboard(code); flash(); }}
        >
          <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={12} />
        </button>
        {onRunCode && (
          <button type="button" className={button} title={t("notes.code.sendToTerminal")} onClick={() => onRunCode(code)}>
            <Icon icon="lucide:square-terminal" width={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function NotesPreview({ value, onChange, readOnly, onRunCode, onRequestEdit }: NotesPreviewProps) {
  const components: Components = {
    a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
    img: ({ src, alt }) => <SafeLink href={typeof src === "string" ? src : undefined}>{alt || String(src ?? "")}</SafeLink>,
    li: ({ node, className, children }) => (
      <TaskLineContext.Provider value={className?.includes("task-list-item") ? node?.position?.start.line ?? null : null}>
        <li className={className?.includes("task-list-item") ? "list-none -ml-4" : undefined}>{children}</li>
      </TaskLineContext.Provider>
    ),
    input: function TaskBox({ type, checked }) {
      const line = useContext(TaskLineContext);
      if (type !== "checkbox") return null;
      return (
        <input
          type="checkbox"
          className="mr-1.5 align-middle accent-(--t-accent)"
          checked={!!checked}
          disabled={readOnly || line === null}
          onChange={() => { if (line !== null) onChange(toggleTaskAtLine(value, line)); }}
        />
      );
    },
    pre: ({ node, children }) => (
      <CodeBlock code={hastText(node as unknown as HastNode).replace(/\n$/, "")} onRunCode={onRunCode}>{children}</CodeBlock>
    ),
  };

  return (
    <div
      className="notes-preview text-sm text-(--t-text-primary) leading-relaxed wrap-break-word"
      onDoubleClick={() => { if (!readOnly) onRequestEdit?.(); }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{value}</ReactMarkdown>
    </div>
  );
}
