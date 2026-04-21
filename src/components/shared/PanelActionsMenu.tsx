import { createPortal } from "react-dom";
import { useRef, useState } from "react";
import { PanelHeaderIconButton } from "@/components/shared/Panel";
import { MenuItemList, type ContextMenuItem } from "@/components/shared/ContextMenu";

interface Props {
  items: ContextMenuItem[];
}

export function PanelActionsMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLDivElement>(null);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={btnRef}>
      <PanelHeaderIconButton icon="lucide:ellipsis" title="More options" onClick={handleOpen} />
      {open && createPortal(
        <>
          {/* Backdrop: closes menu on outside click without swallowing submenu portal clicks */}
          <div className="fixed inset-0 z-[49]" onMouseDown={() => setOpen(false)} />
          <div
            className="fixed p-1.5 rounded-xl flex flex-col z-50 bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)] min-w-[12.667rem]"
            style={{ top: pos.top, right: pos.right, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
          >
            <MenuItemList items={items} onClose={() => setOpen(false)} />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
