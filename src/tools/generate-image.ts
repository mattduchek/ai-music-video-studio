import type { RunContext } from "../context";
import { buildGenerateTool } from "./generate";

export function generateImageTool(ctx: RunContext) {
  return buildGenerateTool(ctx, "image");
}
