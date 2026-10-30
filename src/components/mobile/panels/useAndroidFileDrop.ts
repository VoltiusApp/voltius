import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ContentFile } from "@/services/uploads";
import type { SftpPaneId } from "./sftpSelectionCore";

export const FILE_DRAG_EVENT = "voltius:file-drag";
export const FILES_DROPPED_EVENT = "android://files-dropped";

export type FileDragDetail = { phase: "over"; x: number; y: number } | { phase: "leave" };
export interface FilesDropped { x: number; y: number; files: ContentFile[] }

function paneAt(x: number, y: number): SftpPaneId | null {
  const id = document.elementFromPoint(x, y)?.closest("[data-sftp-pane]")?.getAttribute("data-sftp-pane");
  return id === "a" || id === "b" ? id : null;
}

export function useAndroidFileDrop(
  enabled: boolean,
  fallback: SftpPaneId,
  onDrop: (pane: SftpPaneId, files: ContentFile[]) => void,
): SftpPaneId | null {
  const [hover, setHover] = useState<SftpPaneId | null>(null);
  const latest = useRef({ fallback, onDrop });
  latest.current = { fallback, onDrop };

  useEffect(() => {
    if (!enabled) return;
    const target = (x: number, y: number) => paneAt(x, y) ?? latest.current.fallback;
    const onDrag = (e: Event) => {
      const d = (e as CustomEvent<FileDragDetail>).detail;
      setHover(d.phase === "over" ? target(d.x, d.y) : null);
    };
    window.addEventListener(FILE_DRAG_EVENT, onDrag);
    const unlisten = listen<FilesDropped>(FILES_DROPPED_EVENT, ({ payload }) => {
      setHover(null);
      latest.current.onDrop(target(payload.x, payload.y), payload.files);
    });
    return () => {
      window.removeEventListener(FILE_DRAG_EVENT, onDrag);
      void unlisten.then((fn) => fn());
      setHover(null);
    };
  }, [enabled]);

  return hover;
}
