import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { useRipple } from "@/hooks/useRipple";
import { chevronRotateStyle } from "@/utils/icons";
import { toolbarChevronClass } from "@/components/shared/ToolbarButton";

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
        className={toolbarChevronClass("accent")}
        type="button"
        aria-label={label}
      >
        {rippleEls}
        <span className="[&_path]:stroke-3">
          <Icon icon="lucide:chevron-down" width={20} style={chevronRotateStyle(open)} />
        </span>
      </button>

      <PickerSurface open={open} onClose={close} anchorRef={buttonRef} title={label} width="content" align="right">
        {children(close)}
      </PickerSurface>
    </div>
  );
}
