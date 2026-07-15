import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
  bumpProviderCall,
  bumpToolCall,
  type RunContext,
} from "../context";
import { truncate } from "../logger";
import { estimateCost } from "../pricing";
import { generateMedia, downloadToFile, ProviderError } from "../providers";
import { extractVideoFrames, readImagePreview } from "../ffmpeg";
import type { GenProvider, PreviewImage } from "../types";

interface GenerateResult {
  ok: boolean;
  provider?: string;
  model?: string;
  outputPath?: string;
  outputUrls?: string[];
  costCharged?: number;
  budgetRemaining: number;
  previews?: PreviewImage[];
  error?: string;
  note?: string;
}

type GenInput = {
  provider: GenProvider;
  model: string;
  input: Record<string, unknown>;
  estimatedSeconds?: number;
};

export function buildGenerateTool(ctx: RunContext, kind: "video" | "image") {
  const toolName = kind === "video" ? "generate_video" : "generate_image";
  const generationsDir = join(ctx.workspace, "generations");

  const description =
    kind === "video"
      ? "Generate a video clip via a FAL or Replicate model. Provide the provider, " +
        "the exact model id, and the provider's input object (prompt, duration, etc). " +
        "Pass estimatedSeconds so the budget can be metered. Returns the saved file " +
        "path, sample frames so you can see the result, and the remaining budget."
      : "Generate an image via a FAL or Replicate model. Provide the provider, the " +
        "exact model id, and the provider's input object. Returns the saved file path, " +
        "the image so you can see it, and the remaining budget.";

  return tool<GenInput, GenerateResult>({
    description,
    inputSchema: z.object({
      provider: z.enum(["fal", "replicate"]),
      model: z
        .string()
        .describe('The exact provider model id, e.g. "fal-ai/flux/dev" or "owner/name:version".'),
      input: z
        .record(z.string(), z.unknown())
        .describe("The provider-specific input object (prompt and any parameters)."),
      estimatedSeconds: z
        .number()
        .positive()
        .optional()
        .describe("For video: expected clip length in seconds (used for budgeting)."),
    }),
    execute: async ({ provider, model, input, estimatedSeconds }) => {
      bumpToolCall(ctx, toolName);
      ctx.logger.event("tool_call", {
        tool: toolName,
        args: { provider, model, input: truncate(input, 2000), estimatedSeconds },
      });
      ctx.logger.transcript(`**${toolName}** -> ${provider}:${model}`);

      // Budget gate: refuse paid calls once nothing is left.
      if (!ctx.budget.canSpend()) {
        const result: GenerateResult = {
          ok: false,
          budgetRemaining: ctx.budget.remainingUsd,
          error:
            "Budget exhausted - no more paid generation calls are allowed. You can " +
            "still assemble and edit the video with run_command (ffmpeg).",
        };
        ctx.logger.event("tool_result", { tool: toolName, result });
        return result;
      }

      const estimate = estimateCost({ kind, provider, model, input, estimatedSeconds });

      try {
        const gen = await generateMedia({
          provider,
          model,
          input,
          keys: ctx.keys,
          signal: ctx.signal,
        });
        bumpProviderCall(ctx, provider);

        mkdirSync(generationsDir, { recursive: true });
        const base = join(generationsDir, `${toolName}-${Date.now()}`);
        const savedAbs = await downloadToFile(gen.outputUrls[0]!, base, ctx.signal);
        const outputPath = relative(ctx.workspace, savedAbs);

        let previews: PreviewImage[] = [];
        if (kind === "video") {
          previews = await extractVideoFrames(savedAbs, join(ctx.workspace, ".previews"));
        } else {
          const p = readImagePreview(savedAbs);
          if (p) previews = [p];
        }

        const costUsd = estimate;
        const budgetRemaining = ctx.budget.charge(costUsd, {
          tool: toolName,
          provider,
          model,
          kind: "estimate",
        });
        ctx.stats.generations.push({ provider, model, costUsd, kind: "estimate" });

        const result: GenerateResult = {
          ok: true,
          provider,
          model,
          outputPath,
          outputUrls: gen.outputUrls,
          costCharged: costUsd,
          budgetRemaining,
          previews,
          note:
            budgetRemaining <= 0
              ? "Budget is now exhausted; no further paid generations are allowed."
              : undefined,
        };
        ctx.logger.event("tool_result", {
          tool: toolName,
          result: {
            ok: true,
            provider,
            model,
            outputPath,
            costCharged: result.costCharged,
            budgetRemaining,
            previews: previews.length,
          },
        });
        return result;
      } catch (err) {
        // Failed call = wasted attempt. We do not charge for a hard failure, but
        // we record it so the wasted spend/effort is visible.
        ctx.stats.wastedCalls += 1;
        const message =
          err instanceof ProviderError
            ? `${err.message}${err.detail ? ` :: ${truncate(err.detail, 500)}` : ""}`
            : (err as Error).message;
        const result: GenerateResult = {
          ok: false,
          provider,
          model,
          budgetRemaining: ctx.budget.remainingUsd,
          error: message,
        };
        ctx.logger.event("error", { tool: toolName, provider, model, error: message });
        ctx.logger.event("tool_result", {
          tool: toolName,
          result: { ok: false, provider, model, error: truncate(message, 800) },
        });
        return result;
      }
    },
    toModelOutput: ({ output }) => {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "image-data"; data: string; mediaType: string }
      > = [];
      if (output.ok) {
        parts.push({
          type: "text",
          text:
            `Generated ${kind} with ${output.provider}:${output.model}.\n` +
            `Saved to: ${output.outputPath}\n` +
            `Cost charged: $${output.costCharged?.toFixed(4)}\n` +
            `Budget remaining: $${output.budgetRemaining.toFixed(4)}` +
            (output.note ? `\n${output.note}` : ""),
        });
      } else {
        parts.push({
          type: "text",
          text: `${kind} generation failed: ${output.error}\nBudget remaining: $${output.budgetRemaining.toFixed(4)}`,
        });
      }
      for (const p of output.previews ?? []) {
        parts.push({ type: "image-data", data: p.data, mediaType: p.mediaType });
      }
      return { type: "content", value: parts };
    },
  });
}
