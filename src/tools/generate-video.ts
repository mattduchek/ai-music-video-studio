import type { RunContext } from "../context";
import { buildGenerateTool } from "./generate";

export function generateVideoTool(ctx: RunContext) {
  return buildGenerateTool(ctx, "video");
}
