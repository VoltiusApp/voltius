import { createContext, useContext } from "react";

/** Set inside an Android settings list row, carrying its label: controls render trailing (FormSelect as
 * plain text) and mark themselves as the control a tap on the row forwards to. */
export const ListRowContext = createContext<{ label?: string } | null>(null);

export const useInListRow = () => useContext(ListRowContext) !== null;
export const useListRowLabel = () => useContext(ListRowContext)?.label;
