import { createContext, useContext } from "react";

/**
 * Set inside an Android settings list row (SettingRow), carrying the row label: controls render in their
 * trailing form there, e.g. FormSelect shows its value as text instead of a boxed field,
 * and mark themselves as the control a tap on the row forwards to.
 */
export const ListRowContext = createContext<{ label?: string } | null>(null);

export const useInListRow = () => useContext(ListRowContext) !== null;
export const useListRowLabel = () => useContext(ListRowContext)?.label;
