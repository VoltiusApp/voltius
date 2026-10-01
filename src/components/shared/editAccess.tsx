import type { ComponentType, ReactNode } from "react";
import { useCanEditObject } from "@/hooks/usePermission";
import type { TeamObjectType } from "@/services/teamObjects";

export interface EditAccessProps {
  readOnly: boolean;
}

/** Locks every native control inside it, including ones nested in custom pickers. */
export function ReadOnlyFields({ readOnly, className, children }: {
  readOnly: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={readOnly} className={`min-w-0 ${className ?? ""}`}>
      {children}
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
