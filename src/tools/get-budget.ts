import { tool } from "ai";
import { z } from "zod";
import { bumpToolCall, type RunContext } from "../context";

export function getBudgetTool(ctx: RunContext) {
  return tool({
    description:
      "Check how much of the generation budget remains. Paid generation calls " +
      "are refused once the remaining budget reaches zero.",
    inputSchema: z.object({}),
    execute: async () => {
      bumpToolCall(ctx, "get_budget");
      const result = {
        budgetUsd: ctx.budget.budgetUsd,
        spentUsd: ctx.budget.spentUsd,
        remainingUsd: ctx.budget.remainingUsd,
      };
      ctx.logger.event("tool_call", { tool: "get_budget", args: {} });
      ctx.logger.event("tool_result", { tool: "get_budget", result });
      return result;
    },
  });
}
