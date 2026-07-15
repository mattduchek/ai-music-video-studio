import "dotenv/config";
import type { AgentConfig } from "./types";

function num(value: string | undefined, fallback: number): number {
  const n = value != null && value !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Read `<PREFIX>_IN_PER_1M` / `<PREFIX>_OUT_PER_1M` for token-cost accounting. */
function priceFromEnv(prefix: string): { input: number; output: number } | undefined {
  const input = Number(process.env[`${prefix}_IN_PER_1M`]);
  const output = Number(process.env[`${prefix}_OUT_PER_1M`]);
  return Number.isFinite(input) && Number.isFinite(output) ? { input, output } : undefined;
}

/**
 * The arena roster. Display names are intentionally the product names; the
 * concrete provider model id comes from env so the repo ships without baking in
 * any specific model.
 */
export const AGENTS: AgentConfig[] = [
  {
    key: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    provider: "openai",
    modelId: process.env.SOL_MODEL_ID ?? "gpt-5.6-sol",
    pricePer1M: priceFromEnv("SOL"),
  },
  {
    key: "claude-fable-5",
    name: "Claude Fable 5",
    provider: "anthropic",
    modelId: process.env.FABLE_MODEL_ID ?? "claude-fable-5",
    pricePer1M: priceFromEnv("FABLE"),
  },
];

export const DEFAULTS = {
  budgetUsd: num(process.env.BUDGET_USD, 25),
  maxSteps: num(process.env.MAX_STEPS, 200),
  wallClockMs: num(process.env.WALL_CLOCK_MS, 60 * 60 * 1000),
};

export const KEYS = {
  fal: process.env.FAL_KEY ?? "",
  replicate: process.env.REPLICATE_API_TOKEN ?? "",
  tavily: process.env.TAVILY_API_KEY ?? "",
};
