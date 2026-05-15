export function shouldUseBulkHostContextMenu(selectedCount: number) {
  return selectedCount > 1;
}

export function getHostDeleteTargetIds(clickedId: string, selectedIdSet: Set<string>, selectedConnectionIds: string[]) {
  if (selectedIdSet.has(clickedId) && selectedConnectionIds.length > 1) return selectedConnectionIds;
  return [clickedId];
}

export function shouldOpenSnippetTargetsInSplitTab(targetSessionCount: number) {
  return targetSessionCount > 1;
}
