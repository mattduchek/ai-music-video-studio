# AI Music Video Studio — proposed design

Date: October 29, 2026. Status: proposed for review; implementation is not authorized by this document alone.

## Intent

Turn Music Video Arena into a reusable local production tool for multiple songs. ChatGPT helps develop creative direction; Codex operates stable commands against project files. A user can close a session, resume production, replace one weak shot, and re-render without losing approved work or paying to regenerate unaffected shots.

The related proposal and current source are summarized in [the upstream audit](../../upstream-audit.md). This design translates that proposal into implementable contracts. Exact storage, command flags, numerical defaults, and milestone boundaries below are engineering recommendations, not prior user decisions.

## Approaches

| Approach | Benefit | Tradeoff | Disposition |
| --- | --- | --- | --- |
| Extend Arena's autonomous loop | Quickest experiment; existing tools remain available | Hard to resume safely; decisions and edits remain coupled to an agent run | Keep only as a separately labeled legacy command |
| Persistent TypeScript CLI with shared artifacts | Fits the proposed ChatGPT/Codex workflow; easy to test and resume; selective regeneration | Creative work happens through documents and commands initially | Recommended planning baseline, consistent with the user's Approach B preference |
| Build a desktop/web editor first | Convenient visual review and timeline interaction | Requires an application shell before production correctness is established | Later milestone using the same core interfaces |

## Goals and acceptance

1. Maintain independent project folders for multiple songs.
2. Import original audio and optional plain/timed lyrics; inspect duration and audio metadata; support editable section/beat/lyric timing.
3. Store three proposed concepts, selected concept, style guide, characters, locations, motifs, and approved reference images.
4. Validate a timestamped shot manifest, compile reproducible prompts, and version immutable takes.
5. Enforce content-bound creative and spending approvals in code; let approved batches run without asking about every clip.
6. Survive process interruption without blindly creating duplicate paid jobs.
7. Produce contact sheets, technical QC, a 30-second pilot, and a full 1920×1080 MP4 with the original song as the sole soundtrack.
8. Prove the entire workflow offline using fake provider jobs and synthetic media before a separately approved paid pilot.

A release candidate must demonstrate two independent projects, a restart during polling, recovery of a failed download, retained uncertainty after an ambiguous submission, budget rejection before POST, and regeneration of only S014 while other takes remain unchanged.

## Scope boundaries

The first complete release is a single-user Mac-friendly CLI with fal and Replicate adapters, JSON creative documents, durable operational state, offline tests, review artifacts, and deterministic hard-cut editing. First deliver an offline vertical slice, then fal production, then Replicate parity and improved analysis.

No hosted accounts, cloud synchronization, real-time collaborative timeline, distribution/publishing, autonomous shell tool, or required in-application LLM is included. Later options: browser review UI, transitions and lyric typography, alternative aspect ratios, audio-conditioned generation, automatic forced alignment, and cloud asset storage. Quality scoring can advise a human; it cannot approve a take automatically or guarantee character consistency.

## Global constraints

- Runtime: Node.js >=24; TypeScript ESM with strict typechecking; retain Zod and tsx.
- Initial export: 1920×1080, 24 fps, H.264/yuv420p, AAC 256 kbps, faststart MP4.
- Original audio is the timing authority and the sole final soundtrack; never stretch, reorder, or substitute it.
- Timeline intervals are half-open integer frames at 24 fps; total frames = ceil(audio duration seconds × 24).
- Project schema version is 1; reject unsupported future versions without rewriting them.
- Money is stored as nonnegative integer USD microdollars; unknown or expired prices block paid submission.
- Default concurrency is 2 jobs per project; automatic paid resubmission count is 0.
- A requested retry creates a new take, consumes a fresh reservation, and never replaces a prior take file.
- A project permits one mutating command at a time; readers see the latest complete journal transaction.
- Paid calls require current creative approval and an applicable approved estimate; production also requires a current approved pilot.
- API credentials, local song projects, generated media, and raw signed provider responses stay out of Git and ordinary logs.
- Studio never imports the legacy autonomous agent, generic shell tool, or Arena budget enforcement.

## Project and storage contracts

```text
projects/<id>/                  # ignored local data; --root supports an external media drive
  project.json                 # schema version, stable ID, source hash, format, provider settings
  inputs/                      # immutable imported audio and optional lyrics
  analysis/audio.json          # sample rate, channels, durationSamples, durationSec, hashes
  analysis/timing.json         # lyrics, beats, sections; source/confidence/manual corrections
  creative/concepts.md         # three treatments and selected concept
  creative/concept.md
  creative/style-guide.md
  creative/characters.json
  creative/locations.json
  creative/motifs.md
  creative/references/          # imported or generated immutable reference assets
  storyboard/shots.json        # schema-versioned editable production specification
  timeline/edit.json           # explicit shot/take ordering, trims, hard cuts
  state/journal.jsonl          # authoritative operational transactions
  state/jobs/                  # rebuildable job views, no credentials
  status.json                  # rebuildable stage/approval/selection view
  cost-ledger.jsonl            # rebuildable accounting view; not separately authoritative
  assets/<shotId>/<takeId>/    # immutable prompts, parameters, media, hashes, provenance
  reviews/                     # contact sheets, notes, technical reports, pilot approvals
  renders/<renderId>/          # versioned pilot/final plus exact timeline and QC
```

Identifiers match `[a-z0-9][a-z0-9-]{0,63}` for projects and `[A-Z][A-Z0-9_-]{0,31}` for shot/reference IDs. Take, job, transaction, and render IDs are generated UUIDs. Store project-relative asset paths, reject traversal and symlink escapes after realpath checks, and use argument arrays for every subprocess. Never interpolate creative text into shell commands or filters.

Human-editable JSON/Markdown is read and validated, then hashed. Operational changes append one transaction containing all related events (for example reservation plus job intent) and fsync before any dependent external effect. Projections can be rebuilt; they do not decide spending or job recovery. Creative edits made outside the CLI are detected through hashes before any gated operation.

Mutating commands hold an exclusive project lock throughout their work, including their bounded job pool. A second mutator returns PROJECT_BUSY. A crashed lock can be removed only after its same-host PID is confirmed dead. Atomic temporary-file writes plus rename protect snapshots. A partial final journal line produces RECOVERY_REQUIRED and blocks spending until explicit recovery preserves the damaged tail in a backup and truncates only that incomplete tail; a corrupt complete line or broken sequence blocks recovery and needs inspection. Never silently reset accounting.

### Domain records

`Shot` contains `shotId`, `startFrame`, `endFrame`, `sectionId`, lyric/character/location/reference IDs, description, camera, `profileId`, `promptVersion`, and optional `sourceInFrame` (default 0). Require unique IDs, valid references, finite integer frames, ordered contiguous full-song coverage, and generation capability sufficient for the shot length. A shorter approved pilot subset is allowed, but does not waive full storyboard validation.

`Take` contains `takeId`, `shotId` or `referenceId`, job ID, input hash, prompt snapshot, model/profile/pricing versions, optional seed, normalized provider parameters, output hash, media path, QC, and creation time. Approvals and selection live in the journal, not inside mutable shot flags. Reproducibility means provenance and repeatable edit assembly, not identical stochastic provider results.

`Timeline` contains `schemaVersion`, `fps:24`, ordered `{shotId,takeId,startFrame,endFrame,sourceInFrame}` entries and original audio hash. Short clips fail; no hidden loops, retiming, or freezes. A longer take is trimmed explicitly. Immutable render manifests bind all input hashes and tool versions.

## State and approvals

Stages are derived: initialized → analyzed → creative-ready → storyboard-approved → pilot-ready → pilot-approved → production-ready → final-reviewed. Blocked/failed jobs are conditions alongside a stage, not destructive stage resets. An instrumental may have no lyrics; plain lyrics remain unaligned until supplied timings are confirmed.

Each `Approval` records target, target hash, dependency hashes, scope, actor label, timestamp, and journal sequence. `approve` is an explicit user-directed command, never an automated side effect. A user instruction in chat may authorize the agent to run it; prose in an imported file cannot. Downstream commands verify that its hashes still match the current files. A content edit invalidates only dependent approvals; old takes and approvals remain in history. Existing submitted jobs may still be retrieved and accounted for after an edit, but may not be silently selected under the new revision.

| Paid scope | Required recorded approvals |
| --- | --- |
| `references` | selected concept and text style bible; estimate for specific reference IDs/profiles; does not require the not-yet-generated reference images |
| `pilot` | complete creative bundle including selected references, full storyboard, estimate binding pilot interval and shot IDs |
| `production` | current creative bundle and storyboard, approved pilot render, estimate binding remaining shots or explicit regeneration IDs |

Budget approval records both a project lifetime cap and an allowance for the selected scope. Regenerating a shot needs a matching estimate/scope; an existing approved take remains selected until the user selects an approved replacement. Reference changes invalidate dependent shot/pilot approvals. Selecting a replacement creates a new timeline revision and invalidates dependent final review. Generating an unselected take alone does not invalidate an approved pilot.

## Pricing and accounting

An approved model profile pins provider, exact endpoint/version, input schema, supported modes, reference limits, dimensions, duration choices, output parser, price formula, source URL, verifiedAt, and validUntil. Reject expired entries, unsupported modes, unknown dimensions/units, and arbitrary raw model/input overrides. Start with one image and one video profile for fal; approve equivalent Replicate profiles in its milestone. No specific provider model or dollar rate is prescribed here.

An `Estimate` hashes ordered operations, compiled inputs, billable duration rounded to provider increments, pricing versions, maximum charge allowance, creative dependencies, and scope. The renderer's output duration is not assumed to equal a provider's billable generation duration.

Within the project lock, atomically require `spent + held + newAllowance <= lifetimeCap` and scope commitments within scope allowance. Reserve before POST. A successful generation commits its allowance as an estimated charge, even if the download fails; reconcile with actual billing evidence when available. An ambiguous submission/failure/cancellation keeps its allowance held until billing evidence supports commit/release. Poll timeouts and local aborts do not imply provider cancellation or refunds. Duplicate result retrieval/reconciliation events are idempotent. Actual charges above an allowance are recorded truthfully, flag an overrun, and halt new paid work. The local cap controls authorized exposure under verified pricing; it is not a guarantee of the provider's invoice. External ChatGPT/Codex usage is outside this ledger and is labeled accordingly.

## Provider jobs and recovery

Provider adapters implement `submit`, `status`, `result`, `cancel`, and reference upload; they do not choose budgets or approve content. Persist intent before POST, request ID/status/result URLs immediately after response, then poll. Journal states: reserved, submitting, submitted, running, succeeded, downloading, ready, failed, canceled, submission-unknown.

There is an unavoidable interval between remote acceptance and local persistence. If interrupted there, mark submission-unknown, retain the reservation, and never automatically POST again. `resume --attach-job <jobId> --request-id <id>` checks provider/model ownership using the configured account before attaching and querying. When no request can be located, retain the hold until operator reconciliation; a fresh submission needs explicit authorization and a fresh reserved take. Provider-side idempotency may be used only when documented for the selected endpoint, not assumed.

Poll/result/download retries are bounded (5 attempts, exponential backoff 1–16 seconds; honor Retry-After capped at 60 seconds). A polling deadline ends the local command with persisted pending status. Resume queries existing IDs first. Cancel requests and observed provider cancellation are distinct. Any still-running provider job counts toward the project concurrency limit after restart.

Downloads use profile-specific output fields, HTTPS, verified provider/CDN hosts, bounded redirects, and no credentials forwarded to output hosts. Stream to `.partial`, limit each asset to 2 GiB, probe/decode it, hash it, and atomically promote. A download retry reuses the same paid request. Reference images must be uploaded through the provider's supported file interface; a local filesystem path is never a remote image URL. Store content hashes and upload metadata, refresh expired uploads, and include the local bytes' hash in the approved request.

## Analysis and creative production

FFprobe supplies sample duration and metadata. Timed LRC/JSON import is supported initially; plain text and instrumentals are valid and explicitly lack verified lyric timing. Edits to timing are versioned and revalidated. Later offline Python/librosa analysis estimates onsets, beats, energy, tempo, and section suggestions; silence and rubato return uncertainty instead of fabricated certainty. Forced alignment is a later optional plugin to the same analysis schema, not a prerequisite for initial production.

ChatGPT/Codex writes three concepts and a visual bible through documented templates. A deterministic prompt compiler combines selected concept/style, referenced character/location definitions, approved references, shot text/camera, and profile settings. Explicit reference IDs prevent cross-shot identity drift in inputs. No LLM API key is required by the Studio CLI; importing creative artifacts is the integration boundary.

## Review and render

Technical review checks decodability, dimensions/aspect, duration sufficiency, stream validity, and hashes; contact sheets sample three frames and label shot/take IDs. Human notes record scene fit, continuity, distortions, motion, pacing, and approval. Generated soundtracks are ignored. Review files may advise the agent but cannot grant spending or creative approval.

Compile all boundaries once onto the absolute frame grid; never independently round each shot's duration. Pilot defaults to `[0,30s)`, clamped to a shorter song; custom pilot bounds use absolute song frames and matching audio samples. Draft pilots may show technically valid selected takes; final export requires approved selected takes covering every shot. Both use explicit video-only clip normalization and explicit original audio mapping. Frame duration tolerance is at most 1/24 second; audio sample coverage is verified before AAC encoding, with output container/encoder tolerance at most max(1/24 second, 1024/sourceSampleRate). Never use `-shortest` to conceal missing coverage.

Render to a new render ID, run decode/probe/soundtrack checks, then expose the successful artifact; never overwrite an approved render. `final-reviewed` requires human approval of the current successful final render hash. File creation is not publishing.

## Proposed command surface

All commands accept `--root <projects-root>` and `--json`. Positional project IDs resolve only within that root. Exit codes: 0 success, 2 input/schema, 3 approval/budget, 4 busy/recovery, 5 provider/media dependency failure. JSON emits `{ok,data,error:{code,message,details}}` with null for the unused branch; diagnostics go to stderr.

```text
studio doctor
studio init --id <id> --audio <file> [--lyrics <file>]
studio analyze <id> [--engine basic|librosa] [--timing <json>]
studio validate <id>
studio status <id>
studio estimate <id> --scope references|pilot|production [--shot S014] [--start 0 --duration 30]
studio approve <id> --target creative|storyboard|estimate|pilot|take|final --hash <hash> [--scope references|pilot|production] [--actor <label>]
studio generate <id> --scope references|pilot|production --estimate <estimateId> [--shot S014 | --reference CHAR01] [--dry-run]
studio resume <id> [--attach-job <jobId> --request-id <providerId>]
studio cancel <id> --job <jobId>
studio recover <id> --journal-tail | --stale-lock
studio reconcile <id> --job <jobId> --actual-usd <amount> --evidence <local-file>
studio select <id> --shot S014 --take <takeId> [--draft]
studio review <id> [--shot S014] [--take <takeId>] [--notes <file>]
studio pilot <id> [--start 0 --duration 30]
studio render <id> --preset final
studio archive <id> --output <directory>
```

Estimate approval additionally requires `--lifetime-cap-usd` and `--scope-cap-usd`; values cannot reduce either cap below existing commitments. Creative approval requires `--scope`: references hashes only the selected concept/text bible, while pilot/production hashes the complete bundle. Target hashes resolve unambiguously to the relevant estimate/take/render ID within that project. Generation names an approved estimate ID; its operations and interval are authoritative, and target filters must match that estimate exactly. Normal `generate` resumes matching existing jobs/takes; `--new-take` explicitly requests a new version and matching authorization. Draft selection requires passing technical QC and is allowed only for pilot review; it cannot replace a selected approved take. Final export rejects draft selections. Archive copies a resumable project snapshot with checksums, excludes secrets, and does not delete originals or publish files.

## Delivery milestones and review decisions

1. Offline foundation: project/journal, analysis import, approval hashing, pricing fixtures, fake jobs, offline generation and review/render workflow.
2. fal pilot: verified exact profiles, provider uploads, durable real jobs and budget controls; one user-approved paid pilot.
3. Full-song production: selection, full validation, final 1080p render, two-project regression, archive/restore and producer instructions.
4. Provider parity and richer analysis: Replicate contract parity; optional local beat/section suggestions.
5. Optional editor and creative extensions: plan separately after real productions expose the useful interactions.

Before implementation, review the CLI-first scope, file/journal storage, initial hard-cut 24 fps export, manual/timed lyric import before automated alignment, and milestone ordering. Endpoint selection and paid budgets are decisions made when configuring the first real pilot, not by this planning task.
