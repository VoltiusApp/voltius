import { useT } from "../useT";
import { ConnectionAvatar } from "@voltius/ui";
import type { ObjectRef } from "../state/objectRefs";

const PROTOCOL_LABEL: Record<string, string> = { ssh: "SSH", serial: "SERIAL", ftp: "FTP" };

/** Block card for the primary target of an action (approval card target). */
export function ObjectRefCard({ refObj, id }: { refObj: ObjectRef | null; id: string }) {
  const { t } = useT();
  if (!refObj) {
    return (
      <div
        title={id}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs bg-(--t-bg-card) border border-(--t-border) text-(--t-text-dim)"
      >
        {t("aiAgent.objectRef.unknown")}
      </div>
    );
  }
  const kind = refObj.connection.connection_type;
  const proto = kind ? (PROTOCOL_LABEL[kind] ?? kind.toUpperCase()) : "SSH";
  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 bg-(--t-bg-card) border border-(--t-border)">
      <ConnectionAvatar connection={refObj.connection} size={28} />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-(--t-text-bright) truncate">{refObj.name}</span>
        <span className="text-xs text-(--t-text-secondary) truncate">{refObj.detail}</span>
      </div>
      <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-(--t-bg-input) text-(--t-text-dim) border border-(--t-border)">
        {proto}
      </span>
    </div>
  );
}
