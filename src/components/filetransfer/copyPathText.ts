// Text placed on the OS clipboard by the file-row "Copy path" action:
// a single entry's path, or one path per line for a multi-selection.
export function copyPathText(files: { path: string }[]): string {
  return files.map((f) => f.path).join("\n");
}
