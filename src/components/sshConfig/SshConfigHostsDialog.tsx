import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { CheckboxBox } from "@/components/shared/Checkbox";
import { Toggle } from "@/components/shared/Toggle";
import { useSshConfigStore } from "@/stores/sshConfigStore";
import { FormSelect } from "@/components/shared/FormSelect";
import { PERSONAL_VAULT } from "@/services/vaultLookup";
import { describeError } from "@/services/backendErrors";
import { statusLine } from "./statusLine";
import { usePersonalVaultOptions } from "./vaultOptions";
import { activate, linkAgain, loadPreview, type HostRow, type KeyRow } from "@/services/sshConfig/link";

type Kind<K extends HostRow["kind"]> = Extract<HostRow, { kind: K }>;

const LABEL: { [K in HostRow["kind"]]: (r: Kind<K>, t: TFunction) => { text: string; tone: string } } = {
  create: (_, t) => ({ text: t("settings.hosts.sshConfig.row.create"), tone: "var(--t-status-connected)" }),
  link: (r, t) => ({ text: t(`settings.hosts.sshConfig.row.link.${r.reason}`, { name: r.connectionName }), tone: "var(--t-accent)" }),
  ambiguous: (r, t) => ({ text: t("settings.hosts.sshConfig.row.ambiguous", { names: r.candidates.join(", ") }), tone: "var(--t-status-warning)" }),
  skipped: (r, t) => ({ text: t(`settings.hosts.sshConfig.row.skipped.${r.reason}`), tone: "var(--t-text-dim)" }),
  managed: (r, t) => ({ text: t("settings.hosts.sshConfig.row.managed", { name: r.connectionName }), tone: "var(--t-text-dim)" }),
  detached: (r, t) => ({
    text: t(r.deleted ? "settings.hosts.sshConfig.row.deleted" : "settings.hosts.sshConfig.row.detached", { name: r.connectionName }),
    tone: "var(--t-text-dim)",
  }),
};

const labelOf = (row: HostRow, t: TFunction) => (LABEL[row.kind] as (r: HostRow, t: TFunction) => { text: string; tone: string })(row, t);

function ItemRow({ icon, muted, onClick, lead, children, action }: {
  icon: string;
  muted?: boolean;
  onClick?: () => void;
  lead?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg select-none${onClick ? " cursor-pointer" : ""}`}
      style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", opacity: muted ? 0.7 : 1 }}
    >
      {lead}
      <Icon icon={icon} width={13} style={{ color: "var(--t-text-dim)", flexShrink: 0 }} />
      <div className="flex flex-col min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

function HostItem({ row, activating, ignored, onToggle, onLinkAgain }: {
  row: HostRow;
  activating: boolean;
  ignored: boolean;
  onToggle: () => void;
  onLinkAgain: () => void;
}) {
  const { t } = useTranslation();
  const label = ignored
    ? { text: t("settings.hosts.sshConfig.row.ignored"), tone: "var(--t-text-dim)" }
    : labelOf(row, t);
  const checkable = activating && row.kind === "link";
  return (
    <ItemRow
      icon={row.kind === "skipped" ? "lucide:circle-slash" : "lucide:server"}
      muted={row.kind === "skipped" || row.kind === "ambiguous" || ignored}
      onClick={checkable ? onToggle : undefined}
      lead={activating && (checkable ? <CheckboxBox checked={!ignored} /> : <span className="w-[14px] shrink-0" />)}
      action={row.kind === "detached" && (
        <button onClick={onLinkAgain} className="btn btn-secondary shrink-0 px-2.5 py-1 rounded-md text-xs font-medium">
          {t(row.deleted ? "settings.hosts.sshConfig.dialog.recreate" : "settings.hosts.sshConfig.dialog.linkAgain")}
        </button>
      )}
    >
      <span className="text-sm text-(--t-text-primary) truncate">
        <code className="font-mono">{row.alias}</code>{row.target && <span className="text-xs text-(--t-text-dim)"> · {row.target}</span>}
      </span>
      <span className="text-xs truncate" style={{ color: label.tone }}>{label.text}</span>
      {row.kind === "link" && row.identityName && !ignored && (
        <span className="text-xs truncate" style={{ color: "var(--t-status-warning)" }}>
          {t("settings.hosts.sshConfig.row.identityReplaced", { name: row.identityName })}
        </span>
      )}
    </ItemRow>
  );
}

function KeysSection({ keys, copyKeys, onCopyKeys, vaultName }: { keys: KeyRow[]; copyKeys: boolean; onCopyKeys: (v: boolean) => void; vaultName: string }) {
  const { t } = useTranslation();
  const stateText = (k: KeyRow) => t(`settings.hosts.sshConfig.keys.${k.state[copyKeys ? "copy" : "ref"]}`);
  return (
    <div className="flex flex-col gap-1 pt-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-(--t-text-dim)">{t("settings.hosts.sshConfig.keys.title")}</span>
        <div className="flex items-center gap-2 text-xs text-(--t-text-secondary)">
          {t("settings.hosts.sshConfig.keys.switch")}
          <Toggle checked={copyKeys} onChange={onCopyKeys} aria-label={t("settings.hosts.sshConfig.keys.switch")} />
        </div>
      </div>
      <p className="text-xs text-(--t-text-dim) pb-1">{t("settings.hosts.sshConfig.keys.warning", { vault: vaultName })}</p>
      {keys.map((k) => (
        <ItemRow key={k.path} icon="lucide:key-round">
          <span className="text-sm text-(--t-text-primary) truncate font-mono">{k.name}</span>
          <span className="text-xs text-(--t-text-dim) truncate">{stateText(k)}</span>
        </ItemRow>
      ))}
    </div>
  );
}

export function SshConfigHostsDialog() {
  const { t } = useTranslation();
  const mode = useSshConfigStore((s) => s.dialog);
  const closeDialog = useSshConfigStore((s) => s.closeDialog);
  const sync = useSshConfigStore((s) => s.state.sync);
  const lastRead = useSshConfigStore((s) => s.status.lastRead);
  const savedVault = sync?.vault ?? PERSONAL_VAULT.id;
  const [vault, setVault] = useState(savedVault);
  const vaultOptions = usePersonalVaultOptions(vault);
  const [preview, setPreview] = useState<{ of: string; rows: HostRow[]; keys: KeyRow[] } | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [copyKeys, setCopyKeys] = useState(sync?.copyKeys !== false);
  const [error, setError] = useState<string | null>(null);
  // Nested portals attach before their parent's: wait one commit to stack above Settings opened alongside.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const of = `${mode}:${vault}`;
  const load = useCallback(async (live: () => boolean = () => true) => {
    if (!mode) return;
    try {
      const next = await loadPreview(mode, vault);
      if (live()) setPreview({ of, ...next });
    } catch (e) {
      if (live()) setError(describeError(e, t));
    }
  }, [mode, vault, of, t]);

  useEffect(() => {
    setPreview(null);
    if (!mode) return;
    setUnchecked(new Set());
    setError(null);
    setCopyKeys(sync?.copyKeys !== false);
    setVault(savedVault);
  }, [mode, sync?.copyKeys, savedVault]);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, [load]);

  if (!mode || !mounted) return null;
  const ready = preview?.of === of;
  const rows = ready ? preview.rows : [];
  const keys = ready ? preview.keys : [];
  const activating = mode === "activate";
  const vaultName = vaultOptions.find((o) => o.value === vault)?.label ?? vault;
  const links = rows.filter((r): r is Kind<"link"> => r.kind === "link");
  const pair = (r: Kind<"link">) => ({ alias: r.alias, connectionId: r.connectionId });
  const count = (...kinds: HostRow["kind"][]) => rows.filter((r) => kinds.includes(r.kind)).length;
  const toggle = (alias: string) => setUnchecked((prev) => {
    const next = new Set(prev);
    if (!next.delete(alias)) next.add(alias);
    return next;
  });
  const turnOn = async () => {
    setError(null);
    try {
      await activate(
        {
          links: links.filter((r) => !unchecked.has(r.alias)).map(pair),
          ignored: links.filter((r) => unchecked.has(r.alias)).map(pair),
          creates: rows.filter((r) => r.kind === "create" || r.kind === "ambiguous").map((r) => r.alias),
        },
        vault,
        copyKeys,
      );
    } catch (e) {
      setError(describeError(e, t));
      return;
    }
    closeDialog();
  };
  const counts = activating
    ? t("settings.hosts.sshConfig.dialog.counts", {
      create: count("create", "ambiguous"),
      link: links.length - unchecked.size,
      skipped: count("skipped") + unchecked.size,
      vault: vaultName,
    })
    : statusLine(t, lastRead, count("managed"), count("skipped"));

  return (
    <Modal onClose={closeDialog}>
      <ModalCard className="p-6 flex flex-col gap-4 w-[38rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)" }}>
            <Icon icon="lucide:file-cog" width={16} style={{ color: "var(--t-accent)" }} />
          </div>
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-(--t-text-bright)">
              {t(activating ? "settings.hosts.sshConfig.dialog.activateTitle" : "settings.hosts.sshConfig.dialog.reviewTitle")}
            </h2>
            <span className="text-xs text-(--t-text-dim)">{counts}</span>
          </div>
          {activating && (
            <FormSelect
              className="ml-auto w-40 shrink-0"
              ariaLabel={t("settings.hosts.sshConfig.vault.title")}
              value={vault}
              options={vaultOptions}
              onChange={setVault}
            />
          )}
        </div>
        {activating && <p className="text-sm text-(--t-text-secondary)">{t("settings.hosts.sshConfig.dialog.intro")}</p>}
        <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
          {rows.map((r) => (
            <HostItem
              key={`${r.kind}:${r.alias}`}
              row={r}
              activating={activating}
              ignored={unchecked.has(r.alias)}
              onToggle={() => toggle(r.alias)}
              onLinkAgain={() => r.kind === "detached" && void linkAgain(r.connectionId).then(() => load())}
            />
          ))}
          {activating && keys.length > 0 && <KeysSection keys={keys} copyKeys={copyKeys} onCopyKeys={setCopyKeys} vaultName={vaultName} />}
        </div>
        {error && <p className="text-xs" style={{ color: "var(--t-status-error)" }}>{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={closeDialog} className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium">
            {t(activating ? "settings.hosts.sshConfig.dialog.cancel" : "settings.hosts.sshConfig.dialog.close")}
          </button>
          {activating && (
            <button onClick={() => void turnOn()} disabled={!ready} className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium">
              {t("settings.hosts.sshConfig.dialog.turnOn")}
            </button>
          )}
        </div>
      </ModalCard>
    </Modal>
  );
}
