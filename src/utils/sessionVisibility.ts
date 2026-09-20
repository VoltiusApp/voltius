export function isStatusBarVisible(params: {
  sessionId: string;
  activeSessionId: string | null;
  showSplitWorkspace: boolean;
  overlayContent: boolean;
  sftpPanelOpen: boolean;
}): boolean {
  return (
    params.sessionId === params.activeSessionId &&
    !params.showSplitWorkspace &&
    !params.overlayContent &&
    !params.sftpPanelOpen
  );
}
