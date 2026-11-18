import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import { fromWebviewFiles, type ContentFile } from "@/services/uploads";
import type { SftpPaneId } from "./sftpSelectionCore";

export const FILE_DRAG_EVENT = "voltius:file-drag";
export const FILES_DROPPED_EVENT = "android://files-dropped";

export type FileDragDetail = { phase: "over"; x: number; y: number } | { phase: "leave" };
export interface FilesDropped { x: number; y: number; files: ContentFile[] }

/** Where drops come from: Android's native drop target, or the WebView's own drag events (iOS). */
export type DropSource = "native" | "webview";

const targets: object[] = [];

function setNativeDropTarget(on: boolean) {
  invoke("upload_drop_target", { on }).catch(logFailure("upload_drop_target"));
}

function paneAt(x: number, y: number): SftpPaneId | null {
  const id = document.elementFromPoint(x, y)?.closest("[data-sftp-pane]")?.getAttribute("data-sftp-pane");
  return id === "a" || id === "b" ? id : null;
}

const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

export function useFileDrop(
  source: DropSource | null,
  fallback: SftpPaneId,
  onDrop: (pane: SftpPaneId, files: ContentFile[]) => void,
): SftpPaneId | null {
  const [hover, setHover] = useState<SftpPaneId | null>(null);
  const latest = useRef({ fallback, onDrop });
  latest.current = { fallback, onDrop };

  useEffect(() => {
    if (!source) return;
    const native = source === "native";
    const me = {};
    targets.push(me);
    if (native && targets.length === 1) setNativeDropTarget(true);
    // Last enabled wins: a pushed SFTP screen covers the tab one while both are mounted.
    const mine = () => targets[targets.length - 1] === me;
    const target = (x: number, y: number) => paneAt(x, y) ?? latest.current.fallback;
    const over = (x: number, y: number) => setHover(mine() ? target(x, y) : null);
    const deliver = (x: number, y: number, files: ContentFile[]) => {
      setHover(null);
      if (mine() && files.length) latest.current.onDrop(target(x, y), files);
    };

    const stops: Array<() => void> = [];
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn);
      stops.push(() => window.removeEventListener(type, fn));
    };
    if (native) {
      const onDrag = (e: Event) => {
        const d = (e as CustomEvent<FileDragDetail>).detail;
        if (d.phase === "over") over(d.x, d.y);
        else setHover(null);
      };
      window.addEventListener(FILE_DRAG_EVENT, onDrag);
      stops.push(() => window.removeEventListener(FILE_DRAG_EVENT, onDrag));
      const unlisten = listen<FilesDropped>(FILES_DROPPED_EVENT, ({ payload }) => deliver(payload.x, payload.y, payload.files));
      stops.push(() => void unlisten.then((fn) => fn()));
    } else {
      on("dragover", (e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        over(e.clientX, e.clientY);
      });
      on("dragleave", (e) => {
        if (!e.relatedTarget) setHover(null);
      });
      on("drop", (e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        deliver(e.clientX, e.clientY, mine() ? fromWebviewFiles(e.dataTransfer?.files ?? []) : []);
      });
    }
    return () => {
      targets.splice(targets.indexOf(me), 1);
      if (native && targets.length === 0) setNativeDropTarget(false);
      for (const stop of stops) stop();
      setHover(null);
    };
  }, [source]);

  return hover;
}
