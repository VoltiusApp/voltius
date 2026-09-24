const OPEN_TIMING = "280ms cubic-bezier(0.2, 0, 0, 1)";
const CLOSE_TIMING = "170ms cubic-bezier(0.3, 0, 0.8, 0.15)";

export function panelTransition(open: boolean, ...properties: string[]): string {
  const timing = open ? OPEN_TIMING : CLOSE_TIMING;
  return properties.map((property) => `${property} ${timing}`).join(", ");
}
