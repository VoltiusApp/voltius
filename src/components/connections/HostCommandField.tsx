import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { SnippetChooserList } from "@/components/snippets/SnippetChooserList";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";

export interface HostCommandFieldProps {
  slot: "pre" | "post";
  text: string;
  snippetId: string | undefined;
  onChangeText: (v: string) => void;
  onChangeSnippetId: (v: string | undefined) => void;
}

export function HostCommandField({ slot, text, snippetId, onChangeText, onChangeSnippetId }: HostCommandFieldProps) {
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);
  const snippets = useAllSnippets();
  const picked = snippetId ? snippets.find((s) => s.id === snippetId) : undefined;
  const placeholder = slot === "pre"
    ? t("connections.common.preCommandPlaceholder")
    : t("connections.common.postCommandPlaceholder");

  const close = () => { setChoosing(false); setSearch(""); };

  if (snippetId) {
    return (
      <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs bg-(--t-bg-input) border border-(--t-border)">
        <Icon icon="lucide:braces" width={13} className="text-(--t-accent) shrink-0" />
        <span className="flex-1 truncate text-(--t-text-primary)">
          {picked?.name ?? t("connections.common.hostCommand.missingSnippet")}
        </span>
        <button
          type="button"
          title={t("connections.common.hostCommand.useInline")}
          onClick={() => onChangeSnippetId(undefined)}
          className="shrink-0 text-(--t-text-dim) hover:text-(--t-text-primary)"
        >
          <Icon icon="lucide:x" width={13} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={placeholder}
          className="form-input flex-1 px-2.5 h-8 rounded-lg text-xs outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
        />
        <button
          type="button"
          title={t("connections.common.hostCommand.useSnippet")}
          onClick={() => (choosing ? close() : setChoosing(true))}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-(--t-bg-input) border border-(--t-border) text-(--t-text-dim) hover:text-(--t-text-primary)"
        >
          <Icon icon="lucide:braces" width={13} />
        </button>
      </div>

      <PickerSurface
        open={choosing}
        onClose={close}
        anchorRef={rowRef}
        title={t("connections.common.hostCommand.pickerTitle")}
      >
        <div className="p-1.5 space-y-2">
          <div className="relative">
            <Icon
              icon="lucide:search"
              width={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none"
            />
            <input
              className={`${formInputClass} pl-7 text-xs`}
              style={formInputStyle}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("connections.common.hostCommand.searchPlaceholder")}
              autoFocus
            />
          </div>
          <div className="max-h-52 overflow-y-auto -mx-1.5">
            <SnippetChooserList
              search={search}
              showRecents={false}
              onPick={(s) => {
                onChangeText("");
                onChangeSnippetId(s.id);
                close();
              }}
            />
          </div>
        </div>
      </PickerSurface>
    </>
  );
}
