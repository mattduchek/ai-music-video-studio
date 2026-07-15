import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { buildTools } from "./tools";
import { truncate } from "./logger";
import type { RunContext } from "./context";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}

export interface AgentRunResult {
  finalText?: string;
  usage?: TokenUsage;
  steps?: number;
  aborted: boolean;
  error?: string;
}

export async function runAgent(
  ctx: RunContext,
  opts: { maxSteps: number; system: string }
): Promise<AgentRunResult> {
  const model =
    ctx.agent.provider === "openai"
      ? openai(ctx.agent.modelId)
      : anthropic(ctx.agent.modelId);

  // Turn on native reasoning. For OpenAI we also request reasoning summaries so
  // some of the thinking shows up (raw reasoning is otherwise hidden); for
  // Anthropic we enable extended thinking with a token budget.
  const providerOptions: Record<string, Record<string, JsonValue>> = {};
  if (ctx.agent.provider === "openai") {
    providerOptions.openai = { reasoningEffort: "high", reasoningSummary: "auto" };
  } else {
    // Newer Claude models use adaptive thinking + an effort level (mapped to
    // output_config.effort) rather than a fixed token budget.
    providerOptions.anthropic = {
      thinking: { type: "adaptive", display: "summarized" },
      effort: "high",
    };
  }

  const tools = buildTools(ctx);

  try {
    const res = await generateText({
      model,
      system: opts.system,
      prompt:
        "Begin. Analyze the song, plan the video, generate and refine the shots, " +
        "then assemble and mux the final output.mp4 in your workspace.",
      tools,
      stopWhen: stepCountIs(opts.maxSteps),
      abortSignal: ctx.signal,
      providerOptions,
      onStepFinish: (step) => {
        if (step.reasoningText && step.reasoningText.trim()) {
          ctx.logger.event("model_message", {
            role: "reasoning",
            text: truncate(step.reasoningText, 8000),
          });
          ctx.logger.transcript(`**${ctx.agent.name} (reasoning):**\n\n${step.reasoningText}`);
        }
        if (step.text && step.text.trim()) {
          ctx.logger.event("model_message", {
            text: truncate(step.text, 8000),
            finishReason: step.finishReason,
          });
          ctx.logger.transcript(`**${ctx.agent.name}:** ${step.text}`);
        }
      },
    });

    return {
      finalText: res.text,
      usage: {
        inputTokens: res.totalUsage?.inputTokens,
        outputTokens: res.totalUsage?.outputTokens,
        reasoningTokens: res.totalUsage?.reasoningTokens,
        cachedInputTokens: res.totalUsage?.cachedInputTokens,
        totalTokens: res.totalUsage?.totalTokens,
      },
      steps: res.steps.length,
      aborted: false,
    };
  } catch (err) {
    const aborted = ctx.signal.aborted;
    const message = (err as Error).message;
    ctx.logger.event("error", {
      scope: "agent_loop",
      aborted,
      error: message,
    });
    return { aborted, error: message };
  }
}
