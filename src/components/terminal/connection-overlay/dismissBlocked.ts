import { createContext, useContext } from "react";

export const DismissBlockedContext = createContext<string | undefined>(undefined);

export const useDismissBlocked = () => useContext(DismissBlockedContext);
