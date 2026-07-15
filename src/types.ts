export type GenProvider = "fal" | "replicate";

export interface AgentConfig {
  /** Filesystem-safe slug used for the run directory. */
  key: string;
  /** Human-readable name shown in prompts and logs. */
  name: string;
  /** LLM provider that drives the agent loop. */
  provider: "openai" | "anthropic";
  /** Concrete provider model id (from env). */
  modelId: string;
  /** USD per 1M input/output tokens (from env), for token-cost accounting. */
  pricePer1M?: { input: number; output: number };
}

/** One paid generation call, tracked for the per-model spend breakdown. */
export interface GenerationRecord {
  provider: GenProvider;
  model: string;
  costUsd: number;
  kind: "estimate" | "actual";
}

export interface RunConfig {
  budgetUsd: number;
  maxSteps: number;
  wallClockMs: number;
  /** Absolute path to the source song file. */
  songPath: string;
  agents: AgentConfig[];
}

export interface RunStats {
  toolCalls: Record<string, number>;
  providerCalls: Record<string, number>;
  wastedCalls: number;
  generations: GenerationRecord[];
}

/** A base64-encoded image to hand back to the (multimodal) model. */
export interface PreviewImage {
  data: string;
  mediaType: string;
}

/** Result of a raw generation-provider call. */
export interface ProviderResult {
  outputUrls: string[];
  raw: unknown;
  /** Provider-reported compute seconds, when available (reconciliation hint). */
  predictSeconds?: number;
}
