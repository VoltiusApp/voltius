import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@iconify/react";

interface ChipInputProps {
  value: string[];
  input: string;
  onInputChange: (text: string) => void;
  /** Called with trimmed, non-empty text on Enter or a typed comma. The caller clears `input`. */
  onAdd: (text: string) => void;
  onRemove: (item: string) => void;
  renderChip: (item: string, children: ReactNode) => ReactNode;
  removeLabel: (item: string) => string;
  placeholder?: string;
  emptyIcon?: string;
  ariaLabel?: string;
  onFocus?: () => void;
  onEscape?: () => void;
}

export function ChipInput({
  value, input, onInputChange, onAdd, onRemove, renderChip, removeLabel, placeholder, emptyIcon, ariaLabel, onFocus, onEscape,
}: ChipInputProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setBorder = (color: string) => {
    if (boxRef.current) boxRef.current.style.borderColor = color;
  };

  // Android keyboards send no usable keydown for a comma, so it is read from the text.
  const handleChange = (text: string) => {
    const word = text.slice(0, -1).trim();
    if (text.endsWith(",") && word) onAdd(word);
    else onInputChange(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      onAdd(input.trim());
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      onRemove(value[value.length - 1]);
    } else if (e.key === "Escape") {
      onEscape?.();
    }
  };

  return (
    <div
      ref={boxRef}
      className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-text min-h-[38px]"
      style={{ background: "var(--t-bg-base)", border: "1px solid var(--t-border)", transition: "border-color 150ms" }}
      onClick={() => inputRef.current?.focus()}
      onMouseEnter={() => setBorder("var(--t-border-hover)")}
      onMouseLeave={() => {
        if (document.activeElement !== inputRef.current) setBorder("var(--t-border)");
      }}
    >
      {value.map((item) =>
        renderChip(
          item,
          <>
            {item}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item);
              }}
              className="opacity-60 hover:opacity-100 transition-opacity leading-none"
              aria-label={removeLabel(item)}
            >
              <Icon icon="lucide:x" width={9} />
            </button>
          </>,
        ),
      )}
      <div className="flex items-center gap-1 flex-1 min-w-[80px]">
        {emptyIcon && value.length === 0 && !input && (
          <Icon icon={emptyIcon} width={12} className="text-(--t-text-dim) shrink-0" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          aria-label={ariaLabel}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={onFocus}
          onBlur={() => setBorder("var(--t-border)")}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 bg-transparent outline-hidden text-xs text-(--t-text-primary) placeholder:text-(--t-text-dim) min-w-0"
        />
      </div>
    </div>
  );
}
