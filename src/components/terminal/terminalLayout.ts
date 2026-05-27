export function terminalViewportClass(scrollMinimapEnabled: boolean): string {
  return scrollMinimapEnabled ? "h-full w-full pr-28 terminal-minimap-enabled" : "h-full w-full";
}
