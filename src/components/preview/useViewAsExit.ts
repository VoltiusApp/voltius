import { useState } from "react";
import { usePreviewStore } from "@/stores/previewStore";

export function useViewAsExit() {
  const [confirming, setConfirming] = useState(false);
  return {
    confirming,
    requestExit: () => {
      const { draft, exit } = usePreviewStore.getState();
      if (draft) setConfirming(true);
      else exit();
    },
    confirm: () => {
      setConfirming(false);
      usePreviewStore.getState().exit();
    },
    cancel: () => setConfirming(false),
  };
}
