import { useEffect, useRef, useState } from "react";
import { TAB_TITLE_MAX } from "@/utils/sessionLabel";

/**
 * Renames a thing where its name is written — a tab, a pane header. Opens on
 * the label it replaces, selected, so typing overwrites it and an emptied field
 * is how the caller is told to clear the name.
 *
 * Every pointer and key event is kept inside: the label sits on a button that
 * activates, drags and closes tabs, and none of that may fire while typing.
 */
export function InlineNameEditor({
  value,
  onCommit,
  onCancel,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  // Escape's blur must not commit what Escape just discarded.
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(draft);
  };

  return (
    <input
      ref={ref}
      value={draft}
      aria-label={ariaLabel}
      maxLength={TAB_TITLE_MAX}
      spellCheck={false}
      className={className ?? "min-w-0 max-w-[140px] bg-transparent outline-none"}
      style={{ color: "inherit", font: "inherit" }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    />
  );
}
