import { exec } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { bumpToolCall, type RunContext } from "../context";
import { truncate } from "../logger";
import { readImagePreview } from "../ffmpeg";
import type { PreviewImage } from "../types";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 20 * 1024 * 1024;
const MODEL_OUTPUT_LIMIT = 8000;

/** Keys that must NOT leak into the shell, so generation stays metered. */
const SCRUBBED_ENV = [
  "FAL_KEY",
  "REPLICATE_API_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TAVILY_API_KEY",
  "SOL_MODEL_ID",
  "FABLE_MODEL_ID",
];

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  previews?: PreviewImage[];
  viewErrors?: string[];
}

export function runCommandTool(ctx: RunContext) {
  return tool<
    { command: string; timeoutMs?: number; viewFiles?: string[] },
    CommandResult
  >({
    description:
      "Run a shell command in your workspace directory. ffmpeg and ffprobe are " +
      "installed and on PATH; use them to inspect the song, analyze/generate " +
      "media, cut and concatenate clips, and mux the final video. Network access " +
      "is allowed (e.g. curl docs). The FAL/Replicate API keys are intentionally " +
      "NOT available here; all paid generation must go through generate_video / " +
      "generate_image so it can be metered. Pass image paths in viewFiles to see " +
      "them (e.g. frames you extract from a video with ffmpeg).",
    inputSchema: z.object({
      command: z.string().describe("The shell command to run."),
      timeoutMs: z.number().int().positive().optional(),
      viewFiles: z
        .array(z.string())
        .optional()
        .describe("Image files (relative to the workspace) to return so you can see them."),
    }),
    execute: async ({ command, timeoutMs, viewFiles }) => {
      bumpToolCall(ctx, "run_command");
      ctx.logger.event("tool_call", {
        tool: "run_command",
        args: { command: truncate(command, 2000), timeoutMs, viewFiles },
      });

      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of SCRUBBED_ENV) delete env[k];

      const result = await new Promise<CommandResult>((resolvePromise) => {
        exec(
          command,
          {
            cwd: ctx.workspace,
            timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxBuffer: MAX_BUFFER,
            env,
            signal: ctx.signal,
          },
          (error, stdout, stderr) => {
            const timedOut = Boolean(
              error && (error as NodeJS.ErrnoException).code === "ETIMEDOUT"
            );
            const exitCode =
              error && typeof (error as { code?: unknown }).code === "number"
                ? ((error as { code: number }).code)
                : error
                  ? 1
                  : 0;
            resolvePromise({ exitCode, stdout, stderr, timedOut });
          }
        );
      });

      // Attach requested image files so a multimodal model can actually see them.
      const previews: PreviewImage[] = [];
      const viewErrors: string[] = [];
      for (const rel of viewFiles ?? []) {
        const abs = isAbsolute(rel) ? rel : resolve(ctx.workspace, rel);
        const preview = readImagePreview(abs);
        if (preview) previews.push(preview);
        else viewErrors.push(`Could not read image: ${rel}`);
      }
      if (previews.length) result.previews = previews;
      if (viewErrors.length) result.viewErrors = viewErrors;

      ctx.logger.event("tool_result", {
        tool: "run_command",
        result: {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncate(result.stdout),
          stderr: truncate(result.stderr),
          previews: previews.length,
          viewErrors,
        },
      });
      ctx.logger.transcript(
        `**run_command** (exit ${result.exitCode})\n\n\`\`\`\n${truncate(command, 500)}\n\`\`\``
      );

      return result;
    },
    toModelOutput: ({ output }) => {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "image-data"; data: string; mediaType: string }
      > = [];
      const header =
        `exit code: ${output.exitCode}${output.timedOut ? " (timed out)" : ""}\n` +
        `stdout:\n${truncate(output.stdout, MODEL_OUTPUT_LIMIT)}\n` +
        `stderr:\n${truncate(output.stderr, MODEL_OUTPUT_LIMIT)}`;
      parts.push({ type: "text", text: header });
      for (const err of output.viewErrors ?? []) {
        parts.push({ type: "text", text: err });
      }
      for (const p of output.previews ?? []) {
        parts.push({ type: "image-data", data: p.data, mediaType: p.mediaType });
      }
      return { type: "content", value: parts };
    },
  });
}
