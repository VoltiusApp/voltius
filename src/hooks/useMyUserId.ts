import { useEffect, useState } from "react";
import { getMyUserId } from "@/services/teamService";

// Seeds each new hook instance so a freshly mounted consumer doesn't render one pass as nobody.
let lastKnownUserId = "";

/** The signed-in user's id, or "" until it is known. */
export function useMyUserId(): string {
  const [myUserId, setMyUserId] = useState(lastKnownUserId);

  useEffect(() => {
    getMyUserId().then((id) => {
      lastKnownUserId = id ?? "";
      setMyUserId(lastKnownUserId);
    }).catch(() => {});
  }, []);

  return myUserId;
}
