import { appToast } from "@/services/appToast";

export const tapOrExplain = (reason: string | null | undefined, onTap: () => void) => () => {
  if (reason) appToast("info", reason);
  else onTap();
};

export const greyedTapProps = (reason: string | null | undefined, onTap: () => void) => ({
  "aria-disabled": !!reason || undefined,
  title: reason ?? undefined,
  onClick: tapOrExplain(reason, onTap),
});
