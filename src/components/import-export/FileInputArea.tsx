import { readClipboard } from "../../utils/clipboard";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { ActionBtn } from "./shared";
import { decodeLegacyText } from "@/utils/decodeLegacyText";

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
  openLabel, hasError, rows = 5, onClear,
}: FileInputAreaProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const resolvedOpenLabel = openLabel ?? t("importExport.fileInput.openFileDefault");

  const loadFile = (file: File | undefined) => {
    if (file) void file.arrayBuffer().then((buf) => onChange(decodeLegacyText(new Uint8Array(buf))));
  };

  const handleFileOpen = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = fileAccept;
    input.onchange = () => loadFile(input.files?.[0]);
    input.click();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    loadFile(e.dataTransfer.files[0]);
  };

  const handleClear = () => {
    onChange("");
    onClear?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ActionBtn icon="lucide:folder-open" label={resolvedOpenLabel} onClick={handleFileOpen} />
        <ActionBtn icon="lucide:clipboard" label={t("importExport.fileInput.pasteFromClipboard")} onClick={async () => onChange(await readClipboard())} />
        {text.trim() && (
          <button
            onClick={handleClear}
            className="ml-auto flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--t-text-dim)" }}
          >
            <Icon icon="lucide:x" width={11} />
            {t("importExport.fileInput.clear")}
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
          className="w-full text-xs rounded-lg p-3 resize-none font-mono outline-hidden bg-(--t-bg-terminal) text-(--t-text-secondary) transition-colors"
          style={{ border: `1px solid ${hasError ? "var(--t-status-error)" : dragging ? "var(--t-accent)" : "var(--t-border)"}` }}
        />
        {dragging && (
          <div
            className="absolute inset-0 rounded-lg flex items-center justify-center pointer-events-none"
            style={{ background: "color-mix(in srgb, var(--t-accent) 8%, transparent)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--t-accent)" }}>{t("importExport.fileInput.dropToLoad")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
