import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { useRipple } from "@/hooks/useRipple";
import { chevronRotateStyle } from "@/utils/icons";

/** The chevron half of an accent split button ("New key ▾"); `children` gets `close` for its rows. */
export function SplitMenuChevron({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { createRipple, rippleEls } = useRipple();
  const close = () => setOpen(false);

  return (
    <div>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        onPointerDown={createRipple}
        className="flex items-center justify-center w-8 h-8 transition-colors relative overflow-hidden rounded-tr-[0.533rem] rounded-br-[0.533rem]"
        style={{ background: "var(--t-accent)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-accent-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-accent)")}
        type="button"
        aria-label={label}
      >
        {rippleEls}
        <span className="[&_path]:stroke-3">
          <Icon icon="lucide:chevron-down" width={20} color="var(--t-bg-terminal)" style={chevronRotateStyle(open)} />
        </span>
      </button>

      <PickerSurface open={open} onClose={close} anchorRef={buttonRef} title={label} width="content" align="right">
        {children(close)}
      </PickerSurface>
    </div>
  );
}
