import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { readEditorImage, type EditorReadError } from "@/services/sftp";
import { IMAGE_PREVIEW_HARD_MAX_BYTES, IMAGE_PREVIEW_MAX_BYTES } from "@/services/editorLimits";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";
import { IconBtn } from "@/components/filetransfer/FilePane";
import { formatSize } from "@/components/filetransfer/SFTPTypes";
import { downloadToPickedFolder } from "@/components/filetransfer/osDropPipeline";
import { notify } from "@/services/saveFile";
import { writeClipboardImage } from "@/utils/clipboard";
import { anchoredScroll, effectiveScale, stepZoom, type Size, type Zoom } from "./imageZoom";

const LABELS: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "image/bmp": "BMP",
  "image/vnd.microsoft.icon": "ICO",
  "image/avif": "AVIF",
  "image/svg+xml": "SVG",
};

const CHECKER = {
  backgroundColor: "var(--t-bg-card)",
  backgroundImage: "conic-gradient(var(--t-bg-elevated) 25%, transparent 0 50%, var(--t-bg-elevated) 0 75%, transparent 0)",
  backgroundSize: "16px 16px",
};

const PADDING = 16;

type Load =
  | { kind: "loading" }
  | { kind: "ready"; url: string; mime: string; size: number }
  | { kind: "error"; error: EditorReadError | string };

/** `onNotImage` hands the tab back to the text editor when the bytes turn out not to be an image. */
export function ImageView({ doc, onNotImage }: { doc: EditorDoc; onNotImage: () => void }) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(IMAGE_PREVIEW_MAX_BYTES);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [natural, setNatural] = useState<Size>({ w: 0, h: 0 });
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const viewport = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const anchor = useRef<{ x: number; y: number; from: number; to: number } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setLoad({ kind: "loading" });
    readEditorImage(doc.sftpId, doc.path, limit)
      .then(({ mime, bytes }) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setLoad({ kind: "ready", url, mime, size: bytes.length });
        useEditorStore.getState().markDocImage(doc.id);
      })
      .catch((error: EditorReadError | string) => {
        if (cancelled) return;
        if (typeof error !== "string" && error.kind === "binary") return onNotImage();
        // The backend only reports an image as too large after sniffing it as one.
        if (typeof error !== "string" && error.kind === "too_large") useEditorStore.getState().markDocImage(doc.id);
        setLoad({ kind: "error", error });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.sftpId, doc.path, limit]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth - 2 * PADDING, h: el.clientHeight - 2 * PADDING });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [load.kind]);

  const scale = effectiveScale(zoom, natural, box);
  // Wheel ticks can land several times before a render; each must step from the last one.
  const scaleRef = useRef(scale);
  scaleRef.current = anchor.current?.to ?? scale;

  const zoomTo = (next: number, pointer?: { x: number; y: number }) => {
    const el = viewport.current;
    if (el) {
      const p = pointer ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      anchor.current = { ...p, from: anchor.current?.from ?? scaleRef.current, to: next };
    }
    scaleRef.current = next;
    setZoom(next);
  };

  useLayoutEffect(() => {
    const el = viewport.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = anchoredScroll(el.scrollLeft, a.x, a.from, a.to);
    el.scrollTop = anchoredScroll(el.scrollTop, a.y, a.from, a.to);
  }, [zoom]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    // React's onWheel is passive, so Ctrl+wheel could not stop the page zooming.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(stepZoom(scaleRef.current, e.deltaY < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const pannable = natural.w * scale > box.w || natural.h * scale > box.h;
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pannable || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    e.currentTarget.scrollLeft -= e.clientX - d.x;
    e.currentTarget.scrollTop -= e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") zoomTo(stepZoom(scale, 1));
    else if (e.key === "-") zoomTo(stepZoom(scale, -1));
    else if (e.key === "0") setZoom("fit");
    else if (e.key === "1") zoomTo(1);
    else return;
    e.preventDefault();
  };

  const [copying, setCopying] = useState(false);
  const copy = async () => {
    if (!img.current || copying) return;
    setCopying(true);
    try {
      await writeClipboardImage(img.current);
      notify("success", t("fileTransfer.editor.image.copied"));
    } catch (e) {
      notify("error", t("fileTransfer.editor.image.copyFailed", { error: String(e) }));
    } finally {
      setCopying(false);
    }
  };

  const tooLarge = load.kind === "error" && typeof load.error !== "string" && load.error.kind === "too_large" ? load.error : null;
  const size = load.kind === "ready" ? load.size : tooLarge?.size ?? 0;

  const download = doc.sftpId === null ? null : () => {
    const name = doc.path.split("/").pop() ?? doc.path;
    void downloadToPickedFolder([{ name, path: doc.path, size, isDir: false }], doc.sftpId!);
  };

  const meta = [
    natural.w ? `${natural.w} × ${natural.h}` : null,
    load.kind === "ready" ? LABELS[load.mime] ?? load.mime : null,
    size ? formatSize(size) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center gap-2 shrink-0 px-2 py-1 border-b text-xs"
        style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}
      >
        <span className="truncate min-w-0" style={{ color: "var(--t-text-dim)" }}>
          {doc.hostLabel}:{doc.path}
        </span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <span className="tabular-nums mr-2" style={{ color: "var(--t-text-secondary)" }}>{meta}</span>
          {load.kind === "ready" && (
            <>
              <IconBtn icon="lucide:zoom-out" title={t("fileTransfer.editor.image.zoomOut")} onClick={() => zoomTo(stepZoom(scale, -1))} />
              <button
                className="h-6 min-w-12 px-1.5 rounded-md tabular-nums"
                style={{ color: "var(--t-text-primary)", background: "var(--t-bg-elevated)" }}
                title={t("fileTransfer.editor.image.toggleFit")}
                onClick={() => (zoom === "fit" ? zoomTo(1) : setZoom("fit"))}
              >
                {zoom === "fit" ? t("fileTransfer.editor.image.fit") : `${Math.round(scale * 100)}%`}
              </button>
              <IconBtn icon="lucide:zoom-in" title={t("fileTransfer.editor.image.zoomIn")} onClick={() => zoomTo(stepZoom(scale, 1))} />
              <IconBtn icon={copying ? "lucide:loader-circle" : "lucide:copy"} title={t("fileTransfer.editor.image.copy")} onClick={() => void copy()} />
            </>
          )}
          {download && <IconBtn icon="lucide:download" title={t("fileTransfer.editor.image.download")} onClick={download} />}
        </div>
      </div>
      {load.kind === "loading" && (
        <div className="p-4 text-sm" style={{ color: "var(--t-text-dim)" }}>{t("common.state.loading")}</div>
      )}
      {load.kind === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm" style={{ color: "var(--t-text-secondary)" }}>
          <Icon icon="lucide:image-off" width={28} style={{ color: "var(--t-text-dim)" }} />
          <span>
            {tooLarge
              ? t("fileTransfer.editor.image.tooLarge", { size: formatSize(size), limit: formatSize(limit) })
              : typeof load.error === "string" ? load.error
              : load.error.kind === "io" ? load.error.message
              : t("fileTransfer.editor.tab.error.default")}
          </span>
          <div className="flex gap-2">
            {tooLarge && limit < IMAGE_PREVIEW_HARD_MAX_BYTES && (
              <button
                className="px-3 py-1 rounded-md text-xs"
                style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-primary)" }}
                onClick={() => setLimit(IMAGE_PREVIEW_HARD_MAX_BYTES)}
              >
                {t("fileTransfer.editor.image.previewAnyway")}
              </button>
            )}
            {download && (
              <button
                className="px-3 py-1 rounded-md text-xs font-medium"
                style={{ background: "var(--t-accent)", color: "var(--t-bg-base)" }}
                onClick={download}
              >
                {t("fileTransfer.editor.image.download")}
              </button>
            )}
          </div>
        </div>
      )}
      {load.kind === "ready" && (
        <div
          ref={viewport}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto outline-none"
          style={{ background: "var(--t-bg-base)", cursor: pannable ? (dragging ? "grabbing" : "grab") : "default" }}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="min-h-full min-w-full w-max h-max flex items-center justify-center" style={{ padding: PADDING }}>
            <img
              ref={img}
              src={load.url}
              alt={doc.path}
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={{
                ...CHECKER,
                boxShadow: "0 0 0 1px var(--t-border)",
                maxWidth: "none",
                width: natural.w ? natural.w * scale : undefined,
                height: natural.h ? natural.h * scale : undefined,
                imageRendering: scale > 2 ? "pixelated" : "auto",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
