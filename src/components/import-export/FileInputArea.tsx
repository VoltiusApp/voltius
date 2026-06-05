import { readClipboard } from "../../utils/clipboard";
import { useState } from "react";
import { Icon } from "@iconify/react";
import { ActionBtn } from "./shared";

interface FileInputAreaProps {
  text: string;
  onChange: (text: string) => void;
  placeholder: string;
  fileAccept: string;
  openLabel?: string;
  hasError?: boolean;
  rows?: number;
  onClear?: () => void;
}

export function FileInputArea({
  text, onChange, placeholder, fileAccept,
  openLabel = "Open file…", hasError, rows = 5, onClear,
}: FileInputAreaProps) {
  const [dragging, setDragging] = useState(false);

  const handleFileOpen = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = fileAccept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => onChange(String(e.target?.result ?? ""));
      reader.readAsText(file);
    };
    input.click();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange(String(ev.target?.result ?? ""));
    reader.readAsText(file);
  };

  const handleClear = () => {
    onChange("");
    onClear?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ActionBtn icon="lucide:folder-open" label={openLabel} onClick={handleFileOpen} />
        <ActionBtn icon="lucide:clipboard" label="Paste from Clipboard" onClick={async () => onChange(await readClipboard())} />
        {text.trim() && (
          <button
            onClick={handleClear}
            className="ml-auto flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--t-text-dim)" }}
          >
            <Icon icon="lucide:x" width={11} />
            Clear
          </button>
        )}
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className="relative"
      >
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full text-xs rounded-lg p-3 resize-none font-mono outline-none bg-[var(--t-bg-terminal)] text-[var(--t-text-secondary)] transition-colors"
          style={{ border: `1px solid ${hasError ? "var(--t-status-error)" : dragging ? "var(--t-accent)" : "var(--t-border)"}` }}
        />
        {dragging && (
          <div
            className="absolute inset-0 rounded-lg flex items-center justify-center pointer-events-none"
            style={{ background: "color-mix(in srgb, var(--t-accent) 8%, transparent)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--t-accent)" }}>Drop to load</span>
          </div>
        )}
      </div>
    </div>
  );
}
