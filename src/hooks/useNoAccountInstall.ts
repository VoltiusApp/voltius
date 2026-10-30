import { useEffect, useState } from "react";
import { getAccountMode } from "@/services/account";
import { isNoAccountMode } from "@/utils/accountMode";
import { usePlatform } from "@/utils/platform";

/** False until `read` answers; read once per mount. */
export function useAsyncFlag(read: () => Promise<boolean>): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    let alive = true;
    void read()
      .then((value) => alive && setFlag(value))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [read]);
  return flag;
}

const readNoAccount = async () => isNoAccountMode(await getAccountMode());

export function useNoAccountInstall(): boolean {
  return useAsyncFlag(readNoAccount);
}

/** iOS never runs local sync, so it never pairs. */
export function useCanPairDevices(): boolean {
  const platform = usePlatform();
  return useNoAccountInstall() && platform !== null && platform !== "ios";
}
