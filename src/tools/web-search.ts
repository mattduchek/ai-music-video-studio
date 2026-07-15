import { tool } from "ai";
import { z } from "zod";
import { bumpToolCall, type RunContext } from "../context";
import { truncate } from "../logger";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export function webSearchTool(ctx: RunContext) {
  return tool({
    description:
      "Search the web. Use this to discover which FAL or Replicate models exist " +
      "for video/image generation, their model ids, input parameters, and pricing.",
    inputSchema: z.object({
      query: z.string().describe("The search query."),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    execute: async ({ query, maxResults }) => {
      bumpToolCall(ctx, "web_search");
      ctx.logger.event("tool_call", { tool: "web_search", args: { query, maxResults } });

      if (!ctx.keys.tavily) {
        const result = {
          ok: false,
          error:
            "No web-search key configured. Use run_command with curl to fetch " +
            "specific documentation URLs instead (network access is allowed).",
        };
        ctx.logger.event("tool_result", { tool: "web_search", result });
        return result;
      }

      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: ctx.keys.tavily,
            query,
            max_results: maxResults ?? 5,
          }),
          signal: ctx.signal,
        });
        if (!res.ok) {
          const result = { ok: false, error: `Search failed (${res.status})` };
          ctx.logger.event("tool_result", { tool: "web_search", result });
          return result;
        }
        const data = (await res.json()) as { results?: TavilyResult[]; answer?: string };
        const results = (data.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: truncate(r.content ?? "", 600),
        }));
        const result = { ok: true, answer: data.answer, results };
        ctx.logger.event("tool_result", {
          tool: "web_search",
          result: { ok: true, count: results.length },
        });
        return result;
      } catch (err) {
        const result = { ok: false, error: (err as Error).message };
        ctx.logger.event("tool_result", { tool: "web_search", result });
        return result;
      }
    },
  });
}
