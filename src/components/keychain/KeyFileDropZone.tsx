import { useRef, useState } from "react";
import { Icon } from "@iconify/react";

// ─────────────────────────────────────────────────────────────────
// KeyFileDropZone
// ─────────────────────────────────────────────────────────────────

export function KeyFileDropZone({
  onPrivateKey,
  onPublicKey,
}: {
  onPrivateKey: (v: string) => void;
  onPublicKey: (v: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const counterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      const isPublic =
        file.name.endsWith(".pub") ||
        /^(ssh-|ecdsa-|sk-)/.test(text.trimStart());
      if (isPublic) {
        onPublicKey(text.trim());
      } else {
        onPrivateKey(text.trim());
      }
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 2000);
    };
    reader.onerror = () => {
      setStatus("err");
      setTimeout(() => setStatus("idle"), 2000);
    };
    reader.readAsText(file);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current -= 1;
    if (counterRef.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const borderColor = dragging
    ? "var(--t-accent)"
    : status === "ok"
    ? "var(--t-status-connected)"
    : status === "err"
    ? "var(--t-status-error)"
    : "var(--t-border)";

  const bgColor = dragging
    ? "color-mix(in srgb, var(--t-accent) 8%, transparent)"
    : "transparent";

  const iconColor = dragging
    ? "var(--t-accent)"
    : status === "ok"
    ? "var(--t-status-connected)"
    : status === "err"
    ? "var(--t-status-error)"
    : "var(--t-text-dim)";

  return (
    <div
      className="m-3 flex flex-col items-center justify-center gap-2 rounded-lg py-5 transition-all duration-150"
      style={{
        border: `1.5px dashed ${borderColor}`,
        background: bgColor,
        cursor: "pointer",
      }}
      onClick={() => inputRef.current?.click()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pem,.key,.pub,.ppk,*"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      <Icon
        icon={
          status === "ok"
            ? "lucide:check-circle"
            : status === "err"
            ? "lucide:x-circle"
            : dragging
            ? "lucide:file-down"
            : "lucide:import"
        }
        width={22}
        style={{ color: iconColor, transition: "color 0.15s" }}
      />
      <p className="text-xs text-center" style={{ color: iconColor, transition: "color 0.15s" }}>
        {status === "ok"
          ? "Key file loaded"
          : status === "err"
          ? "Could not read file"
          : dragging
          ? "Drop to load key file"
          : "Drop a key file here"}
      </p>
      {status === "idle" && (
        <p className="text-xs text-(--t-text-muted)">
          .pem, .key, .pub or any SSH key file
        </p>
      )}
    </div>
  );
}
