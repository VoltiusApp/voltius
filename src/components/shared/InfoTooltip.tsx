import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";

export function InfoTooltip({ text, width = 14 }: { text: string; width?: number }) {
  const [visible, setVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const handleEnter = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    }
    setVisible(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={handleEnter}
        onMouseLeave={() => setVisible(false)}
        className="flex items-center justify-center text-[var(--t-text-dim)]"
        tabIndex={-1}
      >
        <Icon icon="lucide:info" width={width} />
      </button>
      {visible && createPortal(
        <div
          className="fixed z-[9999] px-3 py-2 rounded-lg text-xs leading-relaxed pointer-events-none bg-[var(--t-bg-card-hover)] border border-[var(--t-border)] text-[var(--t-text-secondary)]"
          style={{
            top: pos.top,
            left: pos.left,
            transform: "translateX(-50%)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            width: "17.333rem",
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
