import { useMemo } from "react";
import { segmentText } from "../state/segmentText";
import { ObjectRefChip } from "./ObjectRefChip";
import type { ObjectRefResolver } from "./useObjectRefs";

/** Renders text, swapping any known object-id for an inline ObjectRefChip. */
export function RichText({ text, refs }: { text: string; refs: ObjectRefResolver }) {
  const segments = useMemo(() => segmentText(text, refs.knownIds), [text, refs.knownIds]);
  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <span key={i}>{seg.value}</span>
        ) : (
          <ObjectRefChip key={i} id={seg.id} refObj={refs.resolve(seg.id)} />
        ),
      )}
    </span>
  );
}
