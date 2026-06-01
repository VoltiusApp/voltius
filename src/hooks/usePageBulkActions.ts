import { useEffect, useRef } from "react";
import type { NavItem } from "@/stores/uiStore";
import { useUIStore } from "@/stores/uiStore";

interface Options {
  navItem: NavItem;
  filteredIds: string[];
  selectedIdSet: Set<string>;
  setSelection: (ids: string[]) => void;
  /** Called with the selected IDs when Delete fires. Omit to disable the shortcut on this page. */
  onDelete?: (selectedIds: string[]) => void;
}

/**
 * Registers the voltius:select-all and voltius:delete window events for a
 * page that uses drag selection. The ref pattern means listeners are set up
 * once per navItem and always read the latest state without re-registering.
 */
export function usePageBulkActions({ navItem, filteredIds, selectedIdSet, setSelection, onDelete }: Options) {
  const ref = useRef({ filteredIds, selectedIdSet, setSelection, onDelete });
  ref.current = { filteredIds, selectedIdSet, setSelection, onDelete };

  useEffect(() => {
    const handleSelectAll = () => {
      if (useUIStore.getState().activeNav !== navItem) return;
      ref.current.setSelection(ref.current.filteredIds);
    };
    window.addEventListener("voltius:select-all", handleSelectAll);
    return () => window.removeEventListener("voltius:select-all", handleSelectAll);
  }, [navItem]);

  useEffect(() => {
    const handleDelete = () => {
      if (useUIStore.getState().activeNav !== navItem) return;
      const { onDelete: cb, selectedIdSet: sel } = ref.current;
      if (!cb) return;
      const ids = [...sel];
      if (ids.length > 0) cb(ids);
    };
    window.addEventListener("voltius:delete", handleDelete);
    return () => window.removeEventListener("voltius:delete", handleDelete);
  }, [navItem]);
}
