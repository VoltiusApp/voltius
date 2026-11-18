import { createContext, createElement, useCallback, useContext, type ReactNode } from "react";
import { usePreviewStore, type PreviewSession } from "@/stores/previewStore";
import { previewObjectOf } from "@/services/previewSnapshot";

const PreviewContentContext = createContext(false);

export function PreviewContentScope({ children }: { children: ReactNode }) {
  return createElement(PreviewContentContext.Provider, { value: true }, children);
}

export const useInPreviewContent = (): boolean => useContext(PreviewContentContext);

export function usePreviewActive(): PreviewSession | null {
  const inContent = useInPreviewContent();
  return usePreviewStore((s) => (inContent ? s.session : null));
}

export function usePreviewShows(): (objectId: string) => boolean {
  const session = usePreviewActive();
  const result = usePreviewStore((s) => s.result);
  return useCallback((objectId) => !session || !result || !previewObjectOf(result, objectId)?.hidden, [session, result]);
}
