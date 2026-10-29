# Upstream audit and fork provenance

Inspected October 29, 2026.

## Source

- Repository: https://github.com/hershalb/music-video-arena
- Branch: `main`
- Inspected commit: `40ff92b41c606bb7dca027d2107fca1a6e381a33` (`first commit`).
- License: MIT; preserve `LICENSE`, including `Copyright (c) 2026 TryAI`.
- Local checkout preserves the complete upstream Git history.
- Hosted fork: [mattduchek/ai-music-video-studio](https://github.com/mattduchek/ai-music-video-studio), created October 29, 2026; GitHub displays `forked from hershalb/music-video-arena`.
- Remote convention: `origin` points to the user's Studio fork; `upstream` points to `hershalb/music-video-arena`.

## Requirements provenance

The user's October 29 request is to fork the repository and plan the previously proposed AI Music Video Studio. The prior discussion records a preference for Approach B using ChatGPT and Codex. Its proposal describes a TypeScript production CLI, persistent song folders, visual bibles, editable shot manifests, approval gates, versioned takes, enforced budgets, resumable provider jobs, controlled media operations, and deterministic exports. The available excerpt ends in the quality-control section; the design marks additional engineering choices as proposals rather than attributing them to the user.

## What exists and what should change

| Existing source | Verified behavior | Studio treatment |
| --- | --- | --- |
| `package.json`, `tsconfig.json` | TypeScript ESM, strict checks, Zod 4, tsx; `start` and `typecheck` scripts only | Retain foundation; add explicit Studio entry point and offline tests |
| `src/run.ts:80` | New timestamped workspace and in-memory context for each Arena agent | Add persistent project lifecycle; keep legacy entry point explicitly separate |
| `src/agent.ts:26`, `src/prompt.ts` | Autonomous SDK loop generates, edits, and finishes a video | Exclude from default Studio dependency graph; external ChatGPT/Codex supplies creative artifacts |
| `src/providers/fal.ts:18` | Submit, poll, and retrieve in a single function; request ID not saved | Split into durable submit/status/result/cancel operations |
| `src/providers/replicate.ts:21` | Synchronous preference plus in-process polling; prediction interface lacks ID | Async submission and persisted prediction ID |
| `src/providers/errors.ts:13` | Recursively accepts all HTTP URLs in arbitrary response objects | Replace with output parsing specific to each approved model profile |
| `src/providers/index.ts:28` | Buffers download into memory, guesses extension, writes directly to destination | Stream to temporary local file, bound size, validate media, hash, then rename |
| `src/tools/generate.ts:75` | Only checks whether remaining budget is positive | Reserve the full request allowance before submission |
| `src/tools/generate.ts:113` | Charges estimate after successful download; failure increments wasted count without charge | Keep submitted/uncertain liabilities accounted for even if download fails |
| `src/budget.ts:17` | Explicitly permits one call to push balance negative | New persistent reservation ledger; do not reuse this enforcement rule |
| `src/pricing.ts` | Regex rates dated July 13, 2026, guessed dimensions, arbitrary unknown-model fallback | Exact approved profiles with verified pricing source/date, billable units, and bounded requests |
| `src/ffmpeg.ts:39` | Basic probe; failure returns undefined; frame extraction is best effort | Reuse approach, add typed failures, stream timing, strict export QC, controlled argument arrays |
| `src/logger.ts:22` | Constructor clears both log files | New append-safe Studio events and derived summaries; preserve existing Arena behavior initially |
| `src/tools/run-command.ts` | Uses child-process shell execution for arbitrary commands | Never import into Studio; implement typed media operations with `shell: false` |
| `src/run.ts:174` | Output coverage permits two seconds of missing audio/visual duration | Full song coverage, frame-based tolerance, original audio mapping |
| `.gitignore` | Ignores runs, environment files, logs, dependencies | Also ignore local projects, caches, temporary media, and Python environments |

## Verification performed for planning

Source and package configuration were inspected. No `AGENTS.md` was found in this checkout or its immediate ancestor directories. The checkout initially had no local changes. Node `v26.8.1` and npm are available; `gh`, `ffmpeg`, and `ffprobe` were not found on PATH. No dependency installation, typecheck, test run, or media render was performed; this is a documentation task, and upstream has no test script.

## Primary references checked

- [fal asynchronous queue](https://fal.ai/docs/documentation/model-apis/inference/queue): separate submission, status, result, and cancellation; keep request IDs.
- [Replicate prediction creation](https://replicate.com/docs/topics/predictions/create-a-prediction): asynchronous creation returns prediction IDs for subsequent polling.
- [Node test runner](https://nodejs.org/api/test.html): use the built-in runner with the existing tsx loader.
- [FFmpeg stream mapping](https://www.ffmpeg.org/ffmpeg.html) and [filters](https://ffmpeg.org/ffmpeg-filters.html): explicit soundtrack selection and deterministic clip conformance.
- [librosa beat tracking](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html): optional offline beat estimates; human-correctable analysis remains necessary.

No provider model availability or current model pricing is assumed by this plan. Verify a specific endpoint, schema, output parser, and billing rule before enabling its paid profile.
