import type { DownloadDirInfo } from "@/services/downloads";

/** True when we must prompt the SAF picker before downloading (no usable folder set). */
export function needsPicker(dir: DownloadDirInfo | null): boolean {
  return !dir || !dir.uri;
}
