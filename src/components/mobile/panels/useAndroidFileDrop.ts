import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import type { ContentFile } from "@/services/uploads";
import type { SftpPaneId } from "./sftpSelectionCore";

export const FILE_DRAG_EVENT = "voltius:file-drag";
export const FILES_DROPPED_EVENT = "android://files-dropped";

export type FileDragDetail = { phase: "over"; x: number; y: number } | { phase: "leave" };
export interface FilesDropped { x: number; y: number; files: ContentFile[] }

const targets: object[] = [];

function setNativeDropTarget(on: boolean) {
  invoke("upload_drop_target", { on }).catch(logFailure("upload_drop_target"));
}

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
    const me = {};
    targets.push(me);
    if (targets.length === 1) setNativeDropTarget(true);
    // Last enabled wins: a pushed SFTP screen covers the tab one while both are mounted.
    const mine = () => targets[targets.length - 1] === me;
    const target = (x: number, y: number) => paneAt(x, y) ?? latest.current.fallback;
    const onDrag = (e: Event) => {
      const d = (e as CustomEvent<FileDragDetail>).detail;
      setHover(d.phase === "over" && mine() ? target(d.x, d.y) : null);
    };
    window.addEventListener(FILE_DRAG_EVENT, onDrag);
    const unlisten = listen<FilesDropped>(FILES_DROPPED_EVENT, ({ payload }) => {
      setHover(null);
      if (mine()) latest.current.onDrop(target(payload.x, payload.y), payload.files);
    });
    return () => {
      targets.splice(targets.indexOf(me), 1);
      if (targets.length === 0) setNativeDropTarget(false);
      window.removeEventListener(FILE_DRAG_EVENT, onDrag);
      void unlisten.then((fn) => fn());
      setHover(null);
    };
  }, [enabled]);

  return hover;
}
