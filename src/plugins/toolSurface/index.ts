export type { Tool, ToolDecision, ToolRisk, ApprovalVia } from "./types";
export {
  MARKER_PREFIX,
  buildMarkerCommand,
  cleanCapturedOutput,
  captureCommand,
  sendSerialCommand,
} from "./capture";
export {
  MAX_LISTED_CONNECTIONS,
  guardConnectionId,
  guardPlanConnectionIds,
} from "./connectionGuard";
export type { ConnectionRef, ConnectionGuardResult } from "./connectionGuard";
export { buildCoreTools } from "./coreTools";
export type { ToolSurfacePorts } from "./coreTools";
