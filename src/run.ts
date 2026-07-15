import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { AGENTS, DEFAULTS, KEYS } from "./config";
import { BudgetMeter } from "./budget";
import { Logger } from "./logger";
import { runAgent } from "./agent";
import { systemPrompt } from "./prompt";
import { probeDurationSeconds, probeMedia } from "./ffmpeg";
import type { RunContext } from "./context";
import type { AgentConfig, RunStats } from "./types";

interface CliArgs {
  song?: string;
  budget?: number;
  maxSteps?: number;
  only?: string;
  title?: string;
  artist?: string;
  about?: string;
  transcript?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--song") args.song = next();
    else if (a === "--budget") args.budget = Number(next());
    else if (a === "--max-steps") args.maxSteps = Number(next());
    else if (a === "--only") args.only = next();
    else if (a === "--title") args.title = next();
    else if (a === "--artist") args.artist = next();
    else if (a === "--about") args.about = next();
    else if (a === "--transcript") args.transcript = next();
  }
  return args;
}

interface Transcript {
  /** Filename to write into each workspace (e.g. "lyrics.lrc"). */
  file: string;
  text: string;
}

/** Load an optional time-synced transcript / synced-lyrics file. */
function loadTranscript(path: string | undefined): Transcript | undefined {
  if (!path) return undefined;
  const abs = resolve(path);
  if (!existsSync(abs)) {
    console.error(`Transcript not found: ${abs}`);
    process.exit(1);
  }
  const ext = extname(abs) || ".txt";
  return { file: `lyrics${ext}`, text: readFileSync(abs, "utf8") };
}

/** Compose the optional song description injected identically into every agent. */
function buildSongDescription(args: CliArgs): string | undefined {
  const parts: string[] = [];
  if (args.title) parts.push(`Title: ${args.title}`);
  if (args.artist) parts.push(`Artist: ${args.artist}`);
  if (args.about) parts.push(args.about);
  return parts.length ? parts.join("\n") : undefined;
}

async function runOne(
  agent: AgentConfig,
  opts: {
    runRoot: string;
    songPath: string;
    songDuration: number | undefined;
    budgetUsd: number;
    maxSteps: number;
    wallClockMs: number;
    songDescription?: string;
    transcript?: Transcript;
  }
): Promise<void> {
  const dir = join(opts.runRoot, agent.key);
  const workspace = join(dir, "workspace");
  mkdirSync(workspace, { recursive: true });

  const songFile = `song${extname(opts.songPath) || ".mp3"}`;
  copyFileSync(opts.songPath, join(workspace, songFile));
  if (opts.transcript) {
    writeFileSync(join(workspace, opts.transcript.file), opts.transcript.text);
  }

  const logger = new Logger(dir);
  const budget = new BudgetMeter(opts.budgetUsd, logger);
  const stats: RunStats = {
    toolCalls: {},
    providerCalls: {},
    wastedCalls: 0,
    generations: [],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.wallClockMs);

  const ctx: RunContext = {
    agent,
    workspace,
    songFile,
    budget,
    logger,
    stats,
    keys: KEYS,
    signal: controller.signal,
  };

  logger.event("run_start", {
    agent: agent.name,
    model: `${agent.provider}/${agent.modelId}`,
    budgetUsd: opts.budgetUsd,
    maxSteps: opts.maxSteps,
    songFile,
    songDuration: opts.songDuration,
  });

  console.log(`\n=== ${agent.name} (${agent.provider}/${agent.modelId}) ===`);
  const startedAt = Date.now();

  const result = await runAgent(ctx, {
    maxSteps: opts.maxSteps,
    system: systemPrompt({
      agentName: agent.name,
      songFile,
      songDuration: opts.songDuration,
      budgetUsd: opts.budgetUsd,
      songDescription: opts.songDescription,
      transcriptFile: opts.transcript?.file,
      transcriptText: opts.transcript?.text,
    }),
  });

  clearTimeout(timer);

  const outputPath = join(workspace, "output.mp4");
  const producedOutput = existsSync(outputPath);
  const elapsedMs = Date.now() - startedAt;

  // Token cost (only computable if per-model pricing is configured in env).
  const usage = result.usage;
  const price = agent.pricePer1M;
  const tokenCostUsd =
    price && usage
      ? round(
          ((usage.inputTokens ?? 0) / 1e6) * price.input +
            ((usage.outputTokens ?? 0) / 1e6) * price.output
        )
      : null;
  const generationSpendUsd = round(budget.spentUsd);
  const totalCostUsd = tokenCostUsd != null ? round(tokenCostUsd + generationSpendUsd) : null;

  // Spend broken down by generation model.
  const generationBreakdown: Record<string, { count: number; costUsd: number }> = {};
  for (const g of stats.generations) {
    const key = `${g.provider}:${g.model}`;
    const entry = (generationBreakdown[key] ??= { count: 0, costUsd: 0 });
    entry.count += 1;
    entry.costUsd = round(entry.costUsd + g.costUsd);
  }

  // Validate the produced file.
  const media = producedOutput ? await probeMedia(outputPath) : undefined;
  const output = {
    producedOutput,
    path: producedOutput ? outputPath : null,
    durationSec: media?.durationSec,
    resolution: media?.width && media?.height ? `${media.width}x${media.height}` : undefined,
    hasAudio: media?.hasAudio ?? false,
    coversSong:
      media?.durationSec != null && opts.songDuration != null
        ? media.durationSec >= opts.songDuration - 2
        : undefined,
  };

  const summary = {
    agent: agent.name,
    model: `${agent.provider}/${agent.modelId}`,
    elapsedMs,
    elapsedHuman: humanDuration(elapsedMs),
    cost: {
      budgetUsd: opts.budgetUsd,
      generationSpendUsd,
      remainingBudgetUsd: budget.remainingUsd,
      tokenCostUsd,
      totalCostUsd,
      tokenPricingConfigured: Boolean(price),
    },
    tokens: {
      input: usage?.inputTokens,
      output: usage?.outputTokens,
      reasoning: usage?.reasoningTokens,
      cachedInput: usage?.cachedInputTokens,
      total: usage?.totalTokens,
    },
    output,
    generationBreakdown,
    toolCalls: stats.toolCalls,
    providerCalls: stats.providerCalls,
    wastedCalls: stats.wastedCalls,
    steps: result.steps,
    aborted: result.aborted,
    error: result.error,
  };
  logger.summary(summary);
  logger.event("run_end", summary);

  console.log(
    `  output.mp4: ${producedOutput ? "yes" : "NO"}${
      output.durationSec ? ` (${output.durationSec.toFixed(0)}s, audio: ${output.hasAudio})` : ""
    } | generation $${generationSpendUsd.toFixed(2)}/$${opts.budgetUsd.toFixed(2)}` +
      `${tokenCostUsd != null ? ` | tokens $${tokenCostUsd.toFixed(2)}` : " | tokens $? (set pricing)"}` +
      `${totalCostUsd != null ? ` | total $${totalCostUsd.toFixed(2)}` : ""} | ${humanDuration(elapsedMs)}` +
      `${result.aborted ? " | ABORTED (wall clock)" : ""}`
  );
  console.log(`  logs: ${dir}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.song) {
    console.error(
      "Usage: npm start -- --song <path-to-song> [--budget 25] [--max-steps 80] " +
        '[--only <agent-key>] [--title "..."] [--artist "..."] [--about "..."] ' +
        "[--transcript <path-to-lrc-or-txt>]"
    );
    process.exit(1);
  }
  const songPath = resolve(args.song);
  if (!existsSync(songPath)) {
    console.error(`Song not found: ${songPath}`);
    process.exit(1);
  }

  const budgetUsd = args.budget ?? DEFAULTS.budgetUsd;
  const maxSteps = args.maxSteps ?? DEFAULTS.maxSteps;
  const songDescription = buildSongDescription(args);
  const transcript = loadTranscript(args.transcript);

  if (!KEYS.fal && !KEYS.replicate) {
    console.warn("Warning: neither FAL_KEY nor REPLICATE_API_TOKEN is set; generation will fail.");
  }
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.warn("Warning: no LLM provider key set (OPENAI_API_KEY / ANTHROPIC_API_KEY).");
  }

  const agents = args.only ? AGENTS.filter((a) => a.key === args.only) : AGENTS;
  if (agents.length === 0) {
    console.error(`No agents matched --only ${args.only}. Known: ${AGENTS.map((a) => a.key).join(", ")}`);
    process.exit(1);
  }

  const runRoot = join(process.cwd(), "runs", timestamp());
  mkdirSync(runRoot, { recursive: true });
  const songDuration = await probeDurationSeconds(songPath);

  console.log(`Song: ${basename(songPath)} (${songDuration?.toFixed(1) ?? "?"}s)`);
  console.log(`Budget: $${budgetUsd} | maxSteps: ${maxSteps} | agents: ${agents.map((a) => a.key).join(", ")}`);
  console.log(`Song description: ${songDescription ? "provided" : "none (blind run)"}`);
  console.log(`Transcript: ${transcript ? transcript.file : "none"}`);
  console.log(`Run dir: ${runRoot}`);

  for (const agent of agents) {
    await runOne(agent, {
      runRoot,
      songPath,
      songDuration,
      budgetUsd,
      maxSteps,
      wallClockMs: DEFAULTS.wallClockMs,
      songDescription,
      transcript,
    });
  }

  console.log("\nDone.");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function humanDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : "", `${s}s`].filter(Boolean).join("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
