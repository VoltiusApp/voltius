import { createPortal } from "react-dom";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanelHeaderIconButton } from "@/components/shared/Panel";
import { MenuItemList, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { usePopoverFade } from "@/hooks/useDelayedUnmount";

interface Props {
  items: ContextMenuItem[];
}

export function PanelActionsMenu({ items }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLDivElement>(null);
  const fade = usePopoverFade(open);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={btnRef}>
      <PanelHeaderIconButton icon="lucide:ellipsis" title={t("common.action.moreOptions")} onClick={handleOpen} />
      {fade.mounted && createPortal(
        <>
          {/* Backdrop: closes menu on outside click without swallowing submenu portal clicks */}
          {open && <div className="fixed inset-0 z-49" onMouseDown={() => setOpen(false)} />}
          <div
            className={`surface-float fixed p-1.5 flex flex-col z-50 min-w-[12.667rem] ${fade.className}`}
            style={{ ...fade.style, top: pos.top, right: pos.right }}
          >
            <MenuItemList items={items} onClose={() => setOpen(false)} />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
