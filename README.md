# Music Video Arena

An agentic "arena" where large language models compete to make the best music
video. Each model is handed a song, a hard USD budget, both a FAL and a
Replicate API key, a web-search tool, and a `run_command` tool with local
`ffmpeg`, then it iterates: research generation models, generate clips, edit
with `ffmpeg`, watch the result, and refine, until it produces a final
`output.mp4` synced to the track.

The winner is judged **subjectively** by a human. The point is to watch how
different models plan, spend a budget, use tools, recover from failures, and
exercise taste, none of which a one-shot "build me an app" benchmark captures.

## How it works

For each agent the harness:

1. Creates an isolated workspace and copies the song into it.
2. Runs a multi-step tool-calling loop (Vercel AI SDK) until the model stops,
   hits the step cap, or the wall-clock cap.
3. Meters every paid generation call against the budget. Once the budget is
   spent, paid calls are refused (the model can keep editing with `ffmpeg`).
4. Logs every model message, tool call, tool result, charge, and error.

### Tools available to the agent

- `plan` - a no-op "think" scratchpad (à la Anthropic's think tool). Records the
  model's plan/reasoning so it reflects between steps and we can see how it
  reasoned. Native reasoning is also enabled on both models.
- `web_search` - look up which FAL/Replicate models exist and how to call them.
- `get_budget` - check remaining budget.
- `generate_video` - call any FAL or Replicate video model (budget-metered).
- `generate_image` - call any FAL or Replicate image model (budget-metered).
- `run_command` - run arbitrary local shell commands. `ffmpeg`/`ffprobe` are on
  PATH; the model uses them to inspect audio, cut/concat clips, and mux the
  final video. It can pass `viewFiles` to see image frames it extracts.

We deliberately do **not** provide dedicated ffmpeg/audio tools, part of the
experiment is seeing whether a model figures out how to analyze and assemble
media on its own.

## Setup

```bash
npm install
cp .env.example .env   # then fill in keys
```

You also need `ffmpeg` and `ffprobe` on your PATH (`brew install ffmpeg`).

## Run

```bash
npm start -- --song /path/to/song.mp3 --budget 25
```

Optional flags:

- `--only <agent-key>` - run just one agent (e.g. `claude-fable-5`).
- `--max-steps <n>` - cap the agent loop length.
- `--title` / `--artist` / `--about "..."` - an optional song description injected
  identically into every agent's system prompt. The model cannot hear the audio,
  so a little context (title, artist, mood) produces far more coherent videos.
  Omit these for a "blind" run where the model only has ffmpeg analysis to go on.
- `--transcript <path>` - an optional time-synced transcript (an `.lrc` or a
  timestamped `.txt`/`.json`). It is copied into each workspace and injected into
  the prompt as the ground-truth timing for lyrics. Since the model cannot hear
  the audio, this is the reliable way for it to sync shots to specific lyrics.

### Generating a transcript

The model can't hear the song, so precompute lyric timings and pass them with
`--transcript` (same file for every agent = fair + reproducible). Best options:

- Forced alignment (most accurate) if you have the lyrics text, e.g.
  [WhisperX](https://github.com/m-bain/whisperX): `whisperx song.mp3 --output_format lrc`
  (or align known lyrics with aeneas / Montreal Forced Aligner).
- ASR with timestamps if you don't have lyrics: WhisperX / faster-whisper (less
  accurate on music, but no lyrics needed).
- An existing synced-lyrics `.lrc` for popular tracks.

```bash
npm start -- --song ~/Downloads/music_video_arena.mp3 --budget 25 \
  --title "Uptown Funk" --artist "Mark Ronson ft. Bruno Mars" \
  --about "Upbeat retro funk-pop, ~115 BPM, flashy and fun. Think slick 70s/80s style, gold chains, dancing, bright colors, swagger." \
  --transcript ~/Downloads/uptown-funk.lrc
```

Outputs land in `runs/<timestamp>/<model>/`:

- `workspace/output.mp4` - the final music video
- `events.jsonl` - full structured log of everything the model did
- `transcript.md` - human-readable transcript
- `summary.json` - end-to-end time, cost (generation spend + LLM token cost +
  total), token breakdown, output validation (duration/resolution/audio), a
  per-generation-model spend breakdown, and tool/provider call counts

### Token-cost accounting

To report the LLM token cost in dollars, set per-model prices in `.env`
(`SOL_IN_PER_1M` / `SOL_OUT_PER_1M`, `FABLE_IN_PER_1M` / `FABLE_OUT_PER_1M`).
Without them the summary still records token counts but leaves `tokenCostUsd`
null.

## Pilot

The default config runs two agents: `Claude Fable 5` and `GPT-5.6 Sol`. Edit
`src/config.ts` to change the roster.

## Important disclaimers

- **Music licensing.** Only use songs you have the right to use (your own,
  Creative Commons, royalty-free, licensed, or AI-generated). Do not commit
  copyrighted audio or publish videos you do not have rights to.
- **Cost.** These runs spend real money on FAL/Replicate and on LLM tokens
  (agent transcripts plus image frames add up fast). Set a conservative
  `--budget`, start with one model, and watch the logs. Budget accounting is
  best-effort (see below), treat it as a guardrail, not an invoice.
- **Security.** `run_command` executes arbitrary shell commands on your machine
  as directed by an LLM. Run only in an environment you are comfortable with;
  containerization is recommended before running untrusted models.

### On budget accuracy

Because the model may pick any FAL/Replicate model, exact per-call pricing is
not always knowable up front. `src/pricing.ts` holds per-model rates verified
against fal.ai/pricing and replicate.com (with the correct billing unit, per
second, per video, per 1M video tokens, per megapixel, or per image) and reads
the request's resolution/duration so estimates track reality. Unrecognized
models fall back to a conservative per-second rate. Prices drift, so re-check the
provider's model page; treat the meter as a guardrail, not an exact bill. Update
the tables in `src/pricing.ts` when rates change.

## License

MIT
