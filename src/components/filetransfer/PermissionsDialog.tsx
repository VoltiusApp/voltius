import { Fragment, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { Checkbox, CheckboxBox } from "@/components/shared/Checkbox";
import { Pills } from "@/components/shared/Pills";
import { statusSurface } from "@/components/shared/statusSurface";
import { describeError } from "@/services/backendErrors";
import { sftpOwners, sftpSetAttrs, type AttrChange, type OwnerInfo } from "@/services/sftp";
import type { FileEntry } from "./SFTPTypes";
import { parentDir } from "./moveTargetCore";
import {
  commonValue, cycleBit, modeChange, nameChange, parseOctal, symbolicMode, toOctal, triBits,
  type Tri,
} from "./permissionsModel";

type Scope = NonNullable<AttrChange["recurse"]>;

const INPUT_CLASS =
  "form-input px-2 rounded-md outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) placeholder:text-(--t-text-dim) disabled:opacity-50";

function shared<K extends keyof OwnerInfo>(owners: OwnerInfo[] | null | "loading", key: K): OwnerInfo[K] | null {
  return Array.isArray(owners) ? commonValue(owners.map((o) => o[key])) : null;
}

function NameInput({ label, value, onChange, placeholder, hint, disabled, inputClass }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; disabled: boolean; inputClass: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={hint ?? label}
      placeholder={placeholder ?? label}
      disabled={disabled}
      spellCheck={false}
      className={inputClass}
      style={{ width: 0, flex: 1 }}
    />
  );
}

export function PermissionsDialog({ sftpId, files, onClose, onApplied, touch = false }: {
  sftpId: string;
  files: FileEntry[];
  onClose: () => void;
  onApplied: () => void;
  /** Finger-sized checkbox cells and inputs. */
  touch?: boolean;
}) {
  const { t } = useTranslation();
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const initialBits = useMemo(() => triBits(files.map((f) => f.permissions ?? 0)), [files]);
  const [bits, setBits] = useState<Tri[]>(initialBits);
  const [octalDraft, setOctalDraft] = useState<string | null>(null);
  const [owners, setOwners] = useState<OwnerInfo[] | null | "loading">("loading");
  const [owner, setOwner] = useState("");
  const [group, setGroup] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commonOwner = shared(owners, "user");
  const commonGroup = shared(owners, "group");
  const commonUid = shared(owners, "uid");
  const commonGid = shared(owners, "gid");
  const hasShell = Array.isArray(owners);
  const hasDir = files.some((f) => f.isDir);

  useEffect(() => {
    let live = true;
    sftpOwners(sftpId, paths)
      .catch(() => null)
      .then((list) => {
        if (!live) return;
        setOwners(list);
        setOwner(shared(list, "user") ?? "");
        setGroup(shared(list, "group") ?? "");
      });
    return () => { live = false; };
  }, [sftpId, paths]);

  const who = [t("fileTransfer.permissions.owner"), t("fileTransfer.permissions.group"), t("fileTransfer.permissions.others")];
  const what = [t("fileTransfer.permissions.read"), t("fileTransfer.permissions.write"), t("fileTransfer.permissions.execute")];

  const toggle = (i: number) => {
    setOctalDraft(null);
    setBits((prev) => prev.map((b, j) => (j === i ? cycleBit(b, initialBits[i]) : b)));
  };

  const editOctal = (text: string) => {
    setOctalDraft(text);
    const parsed = parseOctal(text, bits);
    if (parsed) setBits(parsed);
  };

  const apply = async () => {
    if (busy) return;
    const change: AttrChange = {
      paths,
      ...modeChange(initialBits, bits),
      owner: hasShell ? nameChange(commonOwner, owner) : undefined,
      group: hasShell ? nameChange(commonGroup, group) : undefined,
      recurse: hasShell && hasDir && recursive ? scope : undefined,
    };
    setBusy(true);
    setError(null);
    try {
      await sftpSetAttrs(sftpId, change);
      onApplied();
    } catch (e) {
      setError(describeError(e, t));
      setBusy(false);
    }
  };

  const single = files.length === 1 ? files[0] : null;
  const folder = commonValue(paths.map(parentDir));
  const ownerDisabled = !hasShell || busy;
  const mixedName = t("fileTransfer.permissions.mixed");
  const cell = touch ? "2.75rem" : "1.75rem";
  const inputClass = `${INPUT_CLASS} ${touch ? "h-10 text-sm" : "h-7 text-xs"}`;
  const buttonClass = touch ? "px-4 py-2.5 rounded-lg text-sm font-medium" : "px-3 py-1.5 rounded-md text-xs font-medium";

  return (
    <Modal onClose={onClose} onEnter={() => void apply()}>
      <ModalCard className="p-4 flex flex-col gap-3" style={{ width: "21rem", maxWidth: "calc(100vw - 2rem)" }}>
        <div className="flex items-center gap-2 min-w-0" title={paths.join("\n")}>
          <Icon icon="lucide:key-round" width={14} className="shrink-0" style={{ color: "var(--t-accent)" }} />
          <h2 className="text-sm font-semibold text-(--t-text-bright) truncate" style={{ flexShrink: 1, minWidth: "3rem" }}>
            {single ? single.name : t("fileTransfer.permissions.items", { count: files.length })}
          </h2>
          {folder && <span className="text-xs font-mono text-(--t-text-dim) truncate">{folder}</span>}
        </div>

        <div className="flex items-start gap-5">
          <div style={{ display: "grid", gridTemplateColumns: `auto repeat(3, ${cell})`, gridAutoRows: touch ? cell : undefined, columnGap: "0.25rem", rowGap: touch ? 0 : "0.375rem", alignItems: "center" }}>
            <span />
            {["r", "w", "x"].map((letter, col) => (
              <span key={letter} title={what[col]} className="text-xs font-mono text-(--t-text-dim)" style={{ textAlign: "center" }}>{letter}</span>
            ))}
            {who.map((whoLabel, row) => (
              <Fragment key={whoLabel}>
                <span className="text-xs text-(--t-text-secondary) pr-2">{whoLabel}</span>
                {what.map((whatLabel, col) => {
                  const i = row * 3 + col;
                  return (
                    <button
                      key={whatLabel}
                      type="button"
                      role="checkbox"
                      aria-checked={bits[i]}
                      aria-label={t("fileTransfer.permissions.bit", { who: whoLabel, what: whatLabel })}
                      disabled={busy}
                      onClick={() => toggle(i)}
                      className="flex items-center justify-center h-full"
                    >
                      <CheckboxBox checked={bits[i]} />
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="flex flex-col gap-1.5" style={{ paddingTop: touch ? cell : "1.375rem" }}>
            <input
              value={octalDraft ?? toOctal(bits) ?? ""}
              onChange={(e) => editOctal(e.target.value.trim())}
              onBlur={() => setOctalDraft(null)}
              placeholder={mixedName}
              aria-label={t("fileTransfer.permissions.octal")}
              disabled={busy}
              maxLength={4}
              spellCheck={false}
              className={`${inputClass} font-mono`}
              style={{ width: "4.5rem" }}
            />
            <span className="text-xs font-mono text-(--t-text-secondary)">{symbolicMode(bits)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Icon icon="lucide:user-round" width={13} className="shrink-0 text-(--t-text-dim)" />
            <NameInput
              label={t("fileTransfer.permissions.owner")}
              value={owner}
              onChange={setOwner}
              placeholder={hasShell && commonOwner == null ? mixedName : undefined}
              hint={commonUid != null ? t("fileTransfer.permissions.uid", { id: commonUid }) : undefined}
              disabled={ownerDisabled}
              inputClass={inputClass}
            />
            <span className="text-xs text-(--t-text-dim)">:</span>
            <NameInput
              label={t("fileTransfer.permissions.group")}
              value={group}
              onChange={setGroup}
              placeholder={hasShell && commonGroup == null ? mixedName : undefined}
              hint={commonGid != null ? t("fileTransfer.permissions.gid", { id: commonGid }) : undefined}
              disabled={ownerDisabled}
              inputClass={inputClass}
            />
          </div>
          {owners === null && (
            <span className="text-xs text-(--t-text-dim)">{t("fileTransfer.permissions.noShell")}</span>
          )}
        </div>

        {hasDir && (
          <div className="flex items-center gap-2">
            <div className={`whitespace-nowrap${ownerDisabled ? " opacity-50 pointer-events-none" : ""}`}>
              <Checkbox checked={recursive && hasShell} onChange={setRecursive} label={t("fileTransfer.permissions.recurse")} />
            </div>
            {recursive && hasShell && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Pills
                  options={[
                    { value: "all", label: t("fileTransfer.permissions.scopeAll") },
                    { value: "files", label: t("fileTransfer.permissions.scopeFiles") },
                    { value: "dirs", label: t("fileTransfer.permissions.scopeDirs") },
                  ]}
                  value={scope}
                  onChange={setScope}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={statusSurface("error")}>
            <Icon icon="lucide:circle-alert" width={14} className="shrink-0 mt-px" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className={`btn btn-secondary ${buttonClass}`}>
            {t("common.action.cancel")}
          </button>
          <button onClick={() => void apply()} disabled={busy} className={`btn btn-primary ${buttonClass}`}>
            {single
              ? t("fileTransfer.permissions.apply")
              : t("fileTransfer.permissions.applyItems", { count: files.length })}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
