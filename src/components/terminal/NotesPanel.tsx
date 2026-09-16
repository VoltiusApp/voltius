import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { NotesEmptyState, NotesFrame } from "@/components/notes/NotesChrome";
import { NotesEditor, type NotesMode } from "@/components/notes/NotesEditor";
import { useNotesDraft } from "@/components/notes/useNotesDraft";
import { useActiveHostConnection } from "@/hooks/useActiveHostConnection";
import { usePermissions } from "@/hooks/usePermission";
import { pasteToSession } from "@/services/terminalPaste";
import { connectionToFormData, useConnectionStore } from "@/stores/connectionStore";
import { findTeamEntry } from "@/stores/teamVaultMap";
import type { Connection, TerminalSession } from "@/types";

async function saveHostNotes(id: string, notes: string | undefined): Promise<void> {
  const { connections, teamConnections, updateConnection } = useConnectionStore.getState();
  const current = connections.find((c) => c.id === id) ?? findTeamEntry(teamConnections, id)?.item;
  if (!current) throw new Error(`host ${id} not found`);
  await updateConnection(id, { ...connectionToFormData(current), notes });
}

export function NotesPanel() {
  const { t } = useTranslation();
  const { session, connection } = useActiveHostConnection();
  if (!session || !connection) {
    return <NotesEmptyState message={t("notes.panel.noHost")} />;
  }
  return <NotesPanelBody key={connection.id} session={session} connection={connection} />;
}

function NotesPanelBody({ session, connection }: { session: TerminalSession; connection: Connection }) {
  const { t } = useTranslation();
  const can = usePermissions();
  const readOnly = !can("EDIT_CONNECTIONS", connection.vault_id ?? "personal");
  const [mode, setMode] = useState<NotesMode>("preview");
  const save = useCallback((notes: string | undefined) => saveHostNotes(connection.id, notes), [connection.id]);
  const notes = useNotesDraft(connection.notes, save);

  const runCode = session.type === "multiplayer"
    ? undefined
    : (code: string) => void pasteToSession(session.id, code);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0">
        <p className="text-sm font-medium text-(--t-text-bright) truncate flex-1">{connection.name || connection.host}</p>
        {readOnly && <span className="text-[10px] text-(--t-text-muted)">{t("notes.panel.readOnly")}</span>}
      </div>
      {notes.conflict && (
        <div className="mx-3 mb-2 px-2.5 py-2 rounded-md border border-(--t-border) bg-(--t-bg-elevated) text-xs flex items-center gap-2">
          <span className="flex-1 text-(--t-text-secondary)">{t("notes.panel.conflict")}</span>
          <button type="button" className="text-(--t-accent)" onClick={notes.reload}>{t("notes.panel.reload")}</button>
          <button type="button" className="text-(--t-text-primary)" onClick={notes.keepMine}>{t("notes.panel.keepMine")}</button>
        </div>
      )}
      {notes.error && (
        <div className="mx-3 mb-2 text-xs flex items-center gap-2 text-(--t-status-error)">
          <span className="flex-1 truncate">{t("notes.panel.saveFailed", { error: notes.error })}</span>
          <button type="button" className="underline" onClick={notes.retry}>{t("notes.panel.retry")}</button>
        </div>
      )}
      <NotesFrame className="flex-1 min-h-0 mx-3 mb-3">
        <NotesEditor
          value={notes.draft}
          onChange={notes.setDraft}
          readOnly={readOnly}
          mode={mode}
          onModeChange={setMode}
          onRunCode={runCode}
          onBlur={notes.flush}
        />
      </NotesFrame>
    </div>
  );
}
