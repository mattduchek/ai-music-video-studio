import type { RunContext } from "../context";
import { webSearchTool } from "./web-search";
import { getBudgetTool } from "./get-budget";
import { generateVideoTool } from "./generate-video";
import { generateImageTool } from "./generate-image";
import { runCommandTool } from "./run-command";
import { planTool } from "./plan";

export function buildTools(ctx: RunContext) {
  return {
    plan: planTool(ctx),
    web_search: webSearchTool(ctx),
    get_budget: getBudgetTool(ctx),
    generate_video: generateVideoTool(ctx),
    generate_image: generateImageTool(ctx),
    run_command: runCommandTool(ctx),
  };
}
