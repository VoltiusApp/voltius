import { Fragment, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { FolderGlyph } from "@/components/folders/folderAppearance";
import { chevronRotateStyle } from "@/utils/icons";
import { hostPickerRowKey, type HostPickerRow } from "@/utils/hostPickerTree";
import type { Connection } from "@/types";

const DENSITY = {
  compact: {
    heading: "px-2.5 text-[10px]",
    folder: "gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-(--t-text-secondary) hover:bg-(--t-bg-elevated)",
    name: "text-xs",
    chevron: 13,
    glyph: 14,
    indentRem: 1.067,
  },
  touch: {
    heading: "px-3 text-[11px]",
    folder: "gap-2 px-3 py-2.5 rounded-xl text-(--t-text-primary) active:bg-(--t-bg-card)",
    name: "text-sm",
    chevron: 16,
    glyph: 16,
    indentRem: 1,
  },
};

type Density = (typeof DENSITY)[keyof typeof DENSITY];

/** Vault → folder → host tree, headed by the recently used hosts when there are any. */
export function HostPickerTree({ rows, recent, onToggleFolder, renderHost, density = "compact" }: {
  rows: HostPickerRow[];
  recent: Connection[];
  onToggleFolder: (id: string) => void;
  renderHost: (c: Connection) => ReactNode;
  density?: keyof typeof DENSITY;
}) {
  const d = DENSITY[density];
  return (
    <>
      <RecentHostsGroup
        recent={recent}
        renderHost={renderHost}
        heading={(label) => <Heading d={d}>{label}</Heading>}
        restHeading={rows.length > 0 && rows[0].kind !== "vault"}
      />
      {rows.map((row) => <TreeRow key={hostPickerRowKey(row)} row={row} d={d} onToggleFolder={onToggleFolder} renderHost={renderHost} />)}
    </>
  );
}

/** `restHeading`: title the hosts that follow, when nothing else heads them. */
export function RecentHostsGroup({ recent, renderHost, heading, restHeading }: {
  recent: Connection[];
  renderHost: (c: Connection) => ReactNode;
  heading: (label: string) => ReactNode;
  restHeading: boolean;
}) {
  const { t } = useTranslation();
  if (recent.length === 0) return null;
  return (
    <>
      <div data-host-picker-recent>
        {heading(t("shared.pickers.recent"))}
        {recent.map((c) => <Fragment key={c.id}>{renderHost(c)}</Fragment>)}
      </div>
      {restHeading && heading(t("common.entity.hosts"))}
    </>
  );
}

function Heading({ d, children, vaultId }: { d: Density; children: ReactNode; vaultId?: string }) {
  return (
    <p data-host-picker-vault={vaultId} className={`${d.heading} pt-3 pb-1 font-semibold uppercase tracking-wider truncate text-(--t-text-dim)`}>
      {children}
    </p>
  );
}

function TreeRow({ row, d, onToggleFolder, renderHost }: {
  row: HostPickerRow;
  d: Density;
  onToggleFolder: (id: string) => void;
  renderHost: (c: Connection) => ReactNode;
}) {
  if (row.kind === "vault") return <Heading d={d} vaultId={row.id}>{row.name}</Heading>;
  const indent = { paddingLeft: `${row.depth * d.indentRem}rem` };
  if (row.kind === "host") return <div style={indent}>{renderHost(row.connection)}</div>;
  return (
    <div style={indent}>
      <button
        data-host-picker-folder={row.folder.id}
        aria-expanded={!row.collapsed}
        onClick={() => onToggleFolder(row.folder.id)}
        className={`w-full flex items-center text-left ${d.folder}`}
      >
        <Icon icon="lucide:chevron-right" width={d.chevron} className="shrink-0 text-(--t-text-dim)" style={chevronRotateStyle(!row.collapsed, 90)} />
        <FolderGlyph folder={row.folder} width={d.glyph} />
        <span className={`flex-1 min-w-0 ${d.name} font-medium truncate`}>{row.folder.name}</span>
        <span className="text-xs shrink-0 text-(--t-text-dim)">{row.count}</span>
      </button>
    </div>
  );
}
