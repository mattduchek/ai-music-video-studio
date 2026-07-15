import { tool } from "ai";
import { z } from "zod";
import { bumpToolCall, type RunContext } from "../context";
import { truncate } from "../logger";

/**
 * A no-op scratchpad tool (à la Anthropic's "think" tool). It does nothing but
 * record the model's plan/reasoning, which (a) encourages structured reflection
 * between generation and ffmpeg steps in a long tool loop, and (b) captures the
 * plan explicitly in our logs so we can see how the model reasoned.
 */
export function planTool(ctx: RunContext) {
  return tool({
    description:
      "Scratchpad for thinking and planning. Use it to reason about the song, " +
      "sketch a shot list, budget your generations, decide what to fix next, or " +
      "reflect on tool results. It performs no action and costs no budget; it just " +
      "records your plan. Call it whenever you want to think before acting.",
    inputSchema: z.object({
      plan: z.string().describe("Your current thoughts, plan, or next steps."),
    }),
    execute: async ({ plan }) => {
      bumpToolCall(ctx, "plan");
      ctx.logger.event("tool_call", { tool: "plan", args: { plan: truncate(plan, 8000) } });
      ctx.logger.transcript(`**${ctx.agent.name} (plan):**\n\n${plan}`);
      return { ok: true };
    },
  });
}
