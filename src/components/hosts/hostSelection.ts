export function shouldUseBulkHostContextMenu(selectedCount: number) {
  return selectedCount > 1;
}

export function shouldOpenSnippetTargetsInSplitTab(targetSessionCount: number) {
  return targetSessionCount > 1;
}
