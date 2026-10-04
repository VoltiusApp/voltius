import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { ColorSwatches } from "@/components/shared/ColorSwatches";
import { PickerSurface } from "@/components/shared/PickerSurface";
import type { Folder } from "@/types";

export const DEFAULT_FOLDER_ICON = "lucide:folder";

export const FOLDER_ICONS = [
  "folder", "server", "database", "cloud", "house", "building-2", "flame", "shield",
  "lock", "key-round", "globe", "network", "router", "wifi", "cpu", "hard-drive",
  "container", "box", "boxes", "layers", "archive", "code", "terminal", "git-branch",
  "bot", "wrench", "settings", "flask-conical", "rocket", "briefcase", "user", "users",
  "monitor", "laptop", "smartphone", "printer", "star", "heart", "zap", "bug",
  "activity", "stethoscope", "book-open", "tag", "gamepad-2", "camera", "music", "leaf",
].map((name) => `lucide:${name}`);

export type FolderAppearance = Pick<Folder, "color" | "icon">;

export function folderIcon(folder: FolderAppearance): string {
  return folder.icon ?? DEFAULT_FOLDER_ICON;
}

export function FolderGlyph({ folder, width, className = "" }: {
  folder: FolderAppearance;
  width: number;
  className?: string;
}) {
  return (
    <Icon
      icon={folderIcon(folder)}
      width={width}
      className={`shrink-0 ${folder.color ? "" : "text-(--t-text-dim)"} ${className}`}
      style={folder.color ? { color: folder.color } : undefined}
    />
  );
}

export function FolderAppearanceFields({ value, onChange }: {
  value: FolderAppearance;
  onChange: (next: FolderAppearance) => void;
}) {
  const { t } = useTranslation();
  const selectedIcon = folderIcon(value);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("folders.appearance.color")}</p>
        <ColorSwatches
          value={value.color ?? ""}
          onChange={(color) => onChange({ ...value, color: color || undefined })}
          clearLabel={t("folders.appearance.clear")}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("folders.appearance.icon")}</p>
        <div className="grid grid-cols-8 gap-1.5">
          {FOLDER_ICONS.map((icon) => {
            const selected = icon === selectedIcon;
            return (
              <button
                key={icon}
                type="button"
                onClick={() => onChange({ ...value, icon: icon === DEFAULT_FOLDER_ICON ? undefined : icon })}
                className="flex items-center justify-center p-0.5 rounded-lg border transition-colors"
                style={{ borderColor: selected ? "var(--t-accent)" : "transparent" }}
                title={icon.slice("lucide:".length)}
                aria-label={icon.slice("lucide:".length)}
                aria-pressed={selected}
              >
                <AvatarTile icon={icon} base={value.color} className="w-7 h-7 rounded-md text-white" iconSize={14} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function FolderAppearancePicker({ open, onClose, anchorRef, value, onChange }: {
  open: boolean;
  onClose: () => void;
  anchorRef: { readonly current: HTMLElement | null };
  value: FolderAppearance;
  onChange: (next: FolderAppearance) => void;
}) {
  const { t } = useTranslation();
  return (
    <PickerSurface open={open} onClose={onClose} anchorRef={anchorRef} title={t("folders.appearance.title")} maxHeight={420}>
      <div className="p-2.5">
        <FolderAppearanceFields value={value} onChange={onChange} />
      </div>
    </PickerSurface>
  );
}
