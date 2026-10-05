import type { SidePhase } from "./SFTPTypes";

/** The session a side should close when it reconnects, sparing the one being relinked. */
export function idToRelease(shown: string | null, keep?: string): string | null {
  return shown && shown !== keep ? shown : null;
}

/** The lost session a reconnect should relink into, so its transfers resume. */
export function relinkOf(phase: SidePhase): string | undefined {
  return phase.tag === "error" ? phase.lostSftpId : undefined;
}
