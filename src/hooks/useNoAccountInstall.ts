import { useEffect, useState } from "react";
import { getAccountMode } from "@/services/account";
import { isNoAccountMode, subscribeAccountMode } from "@/utils/accountMode";
import { runsLocalSync, usePlatform } from "@/utils/platform";

/** False until `read` answers; re-read whenever the account mode changes. */
export function useAsyncFlag(read: () => Promise<boolean>): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void read()
        .then((value) => alive && setFlag(value))
        .catch(() => {});
    load();
    const unsubscribe = subscribeAccountMode(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [read]);
  return flag;
}

const readNoAccount = async () => isNoAccountMode(await getAccountMode());

export function useNoAccountInstall(): boolean {
  return useAsyncFlag(readNoAccount);
}

export function useCanPairDevices(): boolean {
  const platform = usePlatform();
  return useNoAccountInstall() && platform !== null && runsLocalSync(platform);
}
