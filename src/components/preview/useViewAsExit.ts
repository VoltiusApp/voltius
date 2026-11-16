import { useState } from "react";
import { usePreviewStore } from "@/stores/previewStore";

export function useViewAsExit({ afterExit }: { afterExit?: () => void } = {}) {
  const [confirming, setConfirming] = useState(false);
  const exit = () => {
    usePreviewStore.getState().exit();
    afterExit?.();
  };
  return {
    confirming,
    requestExit: () => {
      const { saving, draft } = usePreviewStore.getState();
      if (saving) return;
      if (draft) setConfirming(true);
      else exit();
    },
    confirm: () => {
      setConfirming(false);
      exit();
    },
    cancel: () => setConfirming(false),
  };
}
