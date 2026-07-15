import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type EventType =
  | "run_start"
  | "model_message"
  | "tool_call"
  | "tool_result"
  | "charge"
  | "error"
  | "run_end";

/**
 * Append-only structured logger. Every meaningful thing the agent does becomes
 * one JSON line in `events.jsonl`, plus a human-readable line in `transcript.md`.
 * Payloads are the caller's responsibility to keep small (e.g. omit base64).
 */
export class Logger {
  private readonly eventsPath: string;
  private readonly transcriptPath: string;

  constructor(private readonly dir: string) {
    this.eventsPath = join(dir, "events.jsonl");
    this.transcriptPath = join(dir, "transcript.md");
    writeFileSync(this.eventsPath, "");
    writeFileSync(this.transcriptPath, "# Transcript\n\n");
  }

  event(type: EventType, data: Record<string, unknown> = {}): void {
    const record = { ts: new Date().toISOString(), type, ...data };
    appendFileSync(this.eventsPath, JSON.stringify(record) + "\n");
  }

  transcript(markdown: string): void {
    appendFileSync(this.transcriptPath, markdown + "\n\n");
  }

  summary(summary: Record<string, unknown>): void {
    writeFileSync(
      join(this.dir, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n"
    );
  }
}

/** Trim long strings so tool output does not bloat the logs. */
export function truncate(value: unknown, max = 4000): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s == null) return "";
  return s.length > max ? s.slice(0, max) + `... [truncated ${s.length - max} chars]` : s;
}
