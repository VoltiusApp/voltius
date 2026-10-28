import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import { useCanEditObject } from "@/hooks/usePermission";
import type { TeamObjectType } from "@/services/teamObjects";

export interface EditAccessProps {
  readOnly: boolean;
}

const FieldsReadOnly = createContext(false);

/** True inside a locked ReadOnlyFields, for editors a disabled fieldset cannot reach (contenteditable). */
export const useFieldsReadOnly = () => useContext(FieldsReadOnly);

/** Locks every native control inside it, including ones nested in custom pickers. */
export function ReadOnlyFields({ readOnly, className, children }: {
  readOnly: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={readOnly} className={`min-w-0 ${className ?? ""}`}>
      <FieldsReadOnly.Provider value={readOnly}>{children}</FieldsReadOnly.Provider>
    </fieldset>
  );
}

/**
 * Feeds an editor its live edit access. Losing or regaining it remounts the
 * editor, so unsaved input that can no longer be saved is dropped.
 */
export function withEditAccess<P extends object>(
  type: TeamObjectType,
  objectOf: (props: P) => { id: string; vault_id?: string } | undefined,
  Editor: ComponentType<P & EditAccessProps>,
) {
  return function EditAccess(props: P) {
    const readOnly = !useCanEditObject(type, objectOf(props));
    return <Editor key={readOnly ? "read-only" : "editable"} {...props} readOnly={readOnly} />;
  };
}
