import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { parseQuickConnect, type QuickConnectIntent } from "@/services/quickConnect";
import { launchHost, launchQuickConnect, launchLocalShell } from "@/services/launch";
import { partitionLauncherHosts } from "@/components/layout/newSessionItems";
import type { Connection } from "@/types";

interface NewSessionPopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

interface ShellOption {
  name: string;
  path: string;
}

type Row =
  | { kind: "quick-connect"; intent: Exclude<QuickConnectIntent, null> }
  | { kind: "host"; connection: Connection }
  | { kind: "local-shell"; shell: ShellOption | null };

/** Icon for a shell, keyed loosely off its name. */
function shellIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("powershell")) return "lucide:terminal";
  if (n.includes("cmd") || n.includes("command")) return "lucide:square-chevron-right";
  if (n.includes("wsl")) return "lucide:square-terminal";
  return "lucide:square-terminal";
}

/** "zsh" → "Zsh", leave multi-word names ("PowerShell 7+") untouched. */
function shellLabel(name: string): string {
  return /\s/.test(name) ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

function VaultBadge({ vaultId }: { vaultId: string | undefined }) {
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const effectiveId = vaultId ?? "personal";
  const vault = vaults.find((v) => v.id === effectiveId || v.teamId === effectiveId);
  const team = !vault ? teams.find((t) => t.id === effectiveId) : undefined;
  const name = vault?.name ?? team?.name ?? "Personal";
  const isPersonal = effectiveId === "personal";
  return (
    <span
      className="shrink-0 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm border"
      style={isPersonal
        ? { background: "var(--t-bg-elevated)", color: "var(--t-text-muted)", borderColor: "var(--t-border)" }
        : { background: "color-mix(in srgb, var(--t-accent) 12%, transparent)", color: "var(--t-accent)", borderColor: "color-mix(in srgb, var(--t-accent) 30%, transparent)" }}
    >
      <Icon icon="lucide:vault" width={10} />
      {name}
    </span>
  );
}

export function NewSessionPopover({ anchorRef, onClose }: NewSessionPopoverProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const connections = useAllConnections();
  const sessions = useSessionStore((s) => s.sessions);
  const [shells, setShells] = useState<ShellOption[]>([]);

  useEffect(() => {
    invoke<ShellOption[]>("local_list_shells").then(setShells).catch(() => {});
  }, []);

  // One launcher per detected shell; fall back to a single default shell.
  const localShells: (ShellOption | null)[] = useMemo(
    () => (shells.length ? shells : [null]),
    [shells],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return; // let the "+" button's onClick toggle it closed
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  // Position under the anchor button.
  useEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, r.left - 280) });
  }, [anchorRef]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelected(0); }, [query]);

  const activeConnectionIds = useMemo(
    () => new Set(
      sessions.filter((s) => s.status === "connected" || s.status === "connecting").map((s) => s.connectionId),
    ),
    [sessions],
  );

  const { recent, hosts } = useMemo(
    () => partitionLauncherHosts(connections, activeConnectionIds, query, 5, true),
    [connections, activeConnectionIds, query],
  );

  const quickIntent = useMemo(() => parseQuickConnect(query), [query]);

  // Flat, ordered list of selectable rows — drives keyboard nav and Enter.
  const rows: Row[] = useMemo(() => {
    const r: Row[] = [];
    if (quickIntent) r.push({ kind: "quick-connect", intent: quickIntent });
    for (const c of recent) r.push({ kind: "host", connection: c });
    for (const c of hosts) r.push({ kind: "host", connection: c });
    for (const shell of localShells) r.push({ kind: "local-shell", shell });
    return r;
  }, [quickIntent, recent, hosts, localShells]);

  const activate = useCallback((row: Row) => {
    if (row.kind === "quick-connect") launchQuickConnect(row.intent);
    else if (row.kind === "host") launchHost(row.connection.id);
    else launchLocalShell(row.shell?.path);
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, rows.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      if (e.key === "Enter") { e.preventDefault(); const row = rows[selected]; if (row) activate(row); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected, activate, onClose]);

  // Map a Row to its flat index for selection highlighting.
  let idx = 0;
  const quickIdx = quickIntent ? idx++ : -1;
  const recentStart = idx; idx += recent.length;
  const hostsStart = idx; idx += hosts.length;
  const localStart = idx; idx += localShells.length;

  const statusColor = (c: Connection) =>
    activeConnectionIds.has(c.id) ? "var(--t-status-connected)" : "var(--t-text-muted)";

  const hostRow = (c: Connection, rowIdx: number) => {
    const isSel = selected === rowIdx;
    return (
      <button
        key={`h-${c.id}`}
        data-host-card="true"
        onClick={() => activate({ kind: "host", connection: c })}
        onMouseEnter={() => setSelected(rowIdx)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
        style={{ background: isSel ? "var(--t-border-hover)" : "transparent" }}
      >
        <div className="relative shrink-0">
          <ConnectionAvatar connection={c} size={26} />
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-(--t-bg-modal)"
            style={{ background: statusColor(c) }} />
        </div>
        <span className="flex-1 min-w-0 text-sm font-medium truncate"
          style={{ color: isSel ? "var(--t-accent)" : "var(--t-text-primary)" }}>
          {c.name || `${c.username}@${c.host}`}
        </span>
        <VaultBadge vaultId={c.vault_id} />
        <span className="text-xs shrink-0 text-(--t-text-muted)">{c.username}</span>
      </button>
    );
  };

  const sectionHeader = (label: string, divider: boolean) => (
    <>
      {divider && <div className="border-t border-t-(--t-border) my-1" />}
      <p className="px-3 pt-1 pb-1 text-[11px] font-bold uppercase tracking-widest text-(--t-text-dim)">{label}</p>
    </>
  );

  const quickLabel = quickIntent && (
    quickIntent.kind === "ssh"    ? { t: `Connect to ${quickIntent.user}@${quickIntent.host}`, s: `Port ${quickIntent.port} · SSH`, i: "lucide:arrow-right" } :
    quickIntent.kind === "serial" ? { t: "Serial connection", s: quickIntent.port ?? "Configure port & baud", i: "lucide:ethernet-port" } :
                                    { t: quickIntent.shell ? `Local shell (${quickIntent.shell})` : "Local shell", s: "Open a local terminal", i: "lucide:square-terminal" }
  );

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-100 w-[22rem] overflow-hidden surface-glass-solid animate-fadeIn shadow-xl"
      style={{ top: pos.top, left: pos.left, borderRadius: "var(--r-lg)" }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-b-(--t-border)">
        <Icon icon="lucide:search" width={15} className="text-(--t-accent) shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ssh user@host · serial · local …"
          className="flex-1 bg-transparent text-sm outline-hidden text-(--t-text-primary)"
        />
      </div>

      <div className="overflow-y-auto py-1.5" style={{ maxHeight: "360px" }}>
        {quickIntent && quickLabel && (
          <>
            {sectionHeader("Quick Connect", false)}
            <button
              data-idx={quickIdx}
              onClick={() => activate({ kind: "quick-connect", intent: quickIntent })}
              onMouseEnter={() => setSelected(quickIdx)}
              className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
              style={{ background: selected === quickIdx ? "var(--t-border-hover)" : "transparent" }}
            >
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-(--t-bg-toolbar)">
                <Icon icon={quickLabel.i} width={13} className="text-(--t-accent)" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium" style={{ color: selected === quickIdx ? "var(--t-accent)" : "var(--t-text-primary)" }}>{quickLabel.t}</span>
                <p className="text-xs mt-0.5 text-(--t-text-dim)">{quickLabel.s}</p>
              </div>
            </button>
          </>
        )}

        {recent.length > 0 && (
          <>
            {sectionHeader("Recent", !!quickIntent)}
            {recent.map((c, i) => hostRow(c, recentStart + i))}
          </>
        )}

        {hosts.length > 0 && (
          <>
            {sectionHeader("Hosts", !!quickIntent || recent.length > 0)}
            {hosts.map((c, i) => hostRow(c, hostsStart + i))}
          </>
        )}

        {recent.length === 0 && hosts.length === 0 && !quickIntent && (
          <p className="px-3 py-5 text-sm text-center text-(--t-text-dim)">
            {query.trim() ? `No hosts match "${query.trim()}"` : "No hosts yet"}
          </p>
        )}
      </div>

      {/* Local terminal launchers — one segment per detected shell */}
      <div className="border-t border-t-(--t-border)">
        <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-widest text-(--t-text-dim)">
          New Local Terminal
        </p>
        <div className="flex items-stretch border-t border-t-(--t-border)">
          {localShells.map((shell, i) => {
            const rowIdx = localStart + i;
            const isSel = selected === rowIdx;
            const label = shell ? shellLabel(shell.name) : "Local shell";
            return (
              <div key={shell ? shell.path : "default"} className="flex-1 flex items-stretch min-w-0">
                {i > 0 && <div className="w-px bg-(--t-border)" />}
                <button
                  onClick={() => activate({ kind: "local-shell", shell })}
                  onMouseEnter={() => setSelected(rowIdx)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors min-w-0"
                  style={{
                    background: isSel ? "var(--t-border-hover)" : "transparent",
                    color: isSel ? "var(--t-accent)" : "var(--t-text-secondary)",
                  }}
                >
                  <Icon icon={shell ? shellIcon(shell.name) : "lucide:square-terminal"} width={15} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
