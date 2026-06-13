import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useRuleTunnels } from "@/hooks/useRuleTunnels";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { AvatarTile } from "@/components/shared/AvatarTile";
import MobileFilterBar from "@/components/mobile/MobileFilterBar";
import MobilePanelHeader from "@/components/mobile/panels/MobilePanelHeader";
import RuleActionsSheet from "@/components/mobile/sheets/RuleActionsSheet";
import { RuleForm } from "@/components/port_forwarding/RuleForm";
import type { PortForwardingRule } from "@/types";

type FormRule = PortForwardingRule | null | "new" | undefined;

export default function MobilePortForwardingScreen({ folderId }: { folderId?: string }) {
  const allRules = useAllPortForwardingRules();
  const folders = useAllFolders();
  const { runningRuleCount, statusFor, startRule, stopRule } = useRuleTunnels();
  const push = useMobileNavStore((s) => s.push);
  const createRule = usePortForwardingStore((s) => s.createRule);
  const updateRule = usePortForwardingStore((s) => s.updateRule);

  const [search, setSearch] = useState("");
  const [sheetRule, setSheetRule] = useState<PortForwardingRule | null>(null);
  const [formRule, setFormRule] = useState<FormRule>(undefined);
  const dirtyRef = useRef<boolean>(false);

  const scope = folderId ?? undefined;

  const pfFolders = useMemo(
    () => folders.filter((f) => f.object_type === "port_forwarding"),
    [folders],
  );

  const subfolders = useMemo(
    () => pfFolders.filter((f) => (f.parent_folder_id ?? undefined) === scope),
    [pfFolders, scope],
  );

  const rules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRules
      .filter((r) => (r.folder_id ?? undefined) === scope)
      .filter((r) => {
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          String(r.local_port).includes(q) ||
          String(r.remote_port).includes(q) ||
          r.remote_host.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRules, scope, search]);

  const closeForm = () => { setFormRule(undefined); dirtyRef.current = false; };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader
        title="Port Forwarding"
        right={
          <button data-pf-add onClick={() => setFormRule("new")} className="p-2 text-(--t-text-primary)">
            <Icon icon="lucide:plus" width={22} />
          </button>
        }
      />

      <MobileFilterBar value={search} onChange={setSearch} placeholder="Filter rules…" />

      <div className="px-4 py-1 text-xs text-(--t-text-dim)">
        {allRules.length} total &middot; {runningRuleCount.active} active
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {subfolders.map((f) => {
          const count = allRules.filter((r) => r.folder_id === f.id).length;
          return (
            <button
              key={f.id}
              data-pf-folder
              onClick={() => push({ kind: "more-page", page: "port-forwarding", folderId: f.id })}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-(--t-bg-card)"
            >
              <AvatarTile icon="lucide:folder" className="w-9 h-9 rounded-lg" iconSize={18} />
              <span className="flex-1 min-w-0 text-sm font-medium text-(--t-text-primary) truncate">{f.name}</span>
              <span className="text-xs text-(--t-text-dim)">{count}</span>
              <Icon icon="lucide:chevron-right" width={18} className="text-(--t-text-dim)" />
            </button>
          );
        })}

        {rules.map((rule) => {
          const st = statusFor(rule);
          return (
            <div key={rule.id} data-pf-rule className="w-full flex items-center gap-3 px-4 py-2.5">
              <AvatarTile icon="lucide:arrow-left-right" className="w-9 h-9 rounded-lg" iconSize={18} />
              <button
                className="flex-1 min-w-0 text-left"
                onClick={() => setSheetRule(rule)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{rule.name}</span>
                  <span className="shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-(--t-text-dim)"
                    style={{ background: "var(--t-bg-card)" }}>
                    {rule.tunnel_type}
                  </span>
                </div>
                <div className="text-[11px] text-(--t-text-dim) truncate">{st.statusLabel}</div>
                <div className="text-[11px] font-mono text-(--t-text-dim) truncate">
                  {rule.local_port} &rarr; {rule.remote_host}:{rule.remote_port}
                </div>
              </button>
              <button
                data-pf-toggle
                className="shrink-0 p-2 text-(--t-text-primary)"
                onClick={(e) => {
                  e.stopPropagation();
                  if (st.status === "active") void stopRule(rule);
                  else void startRule(rule);
                }}
              >
                <Icon
                  icon={st.isBusy ? "lucide:loader-circle" : st.status === "active" ? "lucide:pause" : "lucide:play"}
                  width={18}
                  className={st.isBusy ? "animate-spin" : undefined}
                />
              </button>
            </div>
          );
        })}

        {subfolders.length === 0 && rules.length === 0 && (
          <div className="flex flex-col items-center justify-center px-8 py-16 text-center text-(--t-text-dim)">
            <Icon icon="lucide:arrow-left-right" width={28} className="mb-2 opacity-60" />
            <p className="text-sm">{search.trim() ? "No rules match your search" : "No port-forwarding rules yet"}</p>
          </div>
        )}
      </div>

      {formRule !== undefined && formRule !== null && (
        <div className="absolute inset-0 z-40 flex flex-col bg-(--t-bg-base)">
          <div className="flex-1 overflow-y-auto">
            <RuleForm
              rule={formRule === "new" ? null : formRule}
              isDirtyRef={dirtyRef}
              onClose={closeForm}
              onSave={async (data) => {
                if (formRule === "new") await createRule(data);
                else await updateRule(formRule.id, data);
                closeForm();
              }}
            />
          </div>
        </div>
      )}

      {sheetRule && (
        <RuleActionsSheet
          rule={sheetRule}
          onEdit={(r) => { setSheetRule(null); setFormRule(r); }}
          onClose={() => setSheetRule(null)}
        />
      )}
    </div>
  );
}
