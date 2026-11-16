import { appToast } from "@/services/appToast";

export const tapOrExplain = (reason: string | null | undefined, onTap: () => void) => () => {
  if (reason) appToast("info", reason);
  else onTap();
};
