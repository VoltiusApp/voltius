import { createContext, createElement, useContext, type ReactNode } from "react";
import { usePreviewStore, type PreviewSession } from "@/stores/previewStore";

const PreviewContentContext = createContext(false);

export function PreviewContentScope({ children }: { children: ReactNode }) {
  return createElement(PreviewContentContext.Provider, { value: true }, children);
}

export const useInPreviewContent = (): boolean => useContext(PreviewContentContext);

export function usePreviewActive(): PreviewSession | null {
  const inContent = useInPreviewContent();
  return usePreviewStore((s) => (inContent ? s.session : null));
}
