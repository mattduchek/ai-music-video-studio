import type { AgentConfig, RunStats } from "./types";
import type { BudgetMeter } from "./budget";
import type { Logger } from "./logger";

export interface RunContext {
  agent: AgentConfig;
  /** Absolute path to this agent's workspace (the tools' cwd). */
  workspace: string;
  /** Song filename relative to the workspace. */
  songFile: string;
  budget: BudgetMeter;
  logger: Logger;
  stats: RunStats;
  keys: { fal: string; replicate: string; tavily: string };
  /** Wall-clock abort signal for the whole run. */
  signal: AbortSignal;
}

export function bumpToolCall(ctx: RunContext, tool: string): void {
  ctx.stats.toolCalls[tool] = (ctx.stats.toolCalls[tool] ?? 0) + 1;
}

export function bumpProviderCall(ctx: RunContext, provider: string): void {
  ctx.stats.providerCalls[provider] = (ctx.stats.providerCalls[provider] ?? 0) + 1;
}
