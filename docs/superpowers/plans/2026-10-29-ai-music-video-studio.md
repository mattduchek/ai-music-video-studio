# AI Music Video Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable local music-video production CLI with approved creative artifacts, versioned shots, controlled spending, resumable jobs, and deterministic original-audio exports.

**Architecture:** Keep the upstream TypeScript foundation and extract provider/media primitives into a separate Studio command path. Human-editable creative documents and an append-only operational journal preserve production state across sessions. Approval and accounting checks execute before any paid effect; rendering consumes explicit take selections and a validated frame timeline.

**Tech Stack:** Node.js >=24, TypeScript ESM/strict, existing Zod 4 and tsx, built-in `node:test`, native fetch/streams, FFmpeg/FFprobe; optional Python/librosa analysis in Task 13.

**Spec:** [Proposed design](../specs/2026-10-29-ai-music-video-studio-design.md). Read it with [the upstream audit](../../upstream-audit.md). This plan is for review; no Studio implementation or paid production has occurred.

## Global Constraints

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

## Review Focus

1. A process dies after remote acceptance but before saving its request ID: retain liability and block automatic resubmission (Tasks 6–7, 11).
2. Two commands race for the last budget allowance: one mutator wins and total commitments never exceed authorization (Tasks 1, 6).
3. A creative/reference edit or replacement take leaves stale approvals: only matching content may authorize subsequent actions (Tasks 4–5, 8–10).
4. Awkward audio lengths, short clips, and mixed clip formats: no accumulated rounding gaps, truncated ending, or provider audio leakage (Tasks 3, 8–9).
5. Paths, symlinks, malicious output URLs, and damaged journal tails: fail before effects without overwriting source media or resetting accounting (Tasks 1–2, 7, 11).

---

## Scope, ordering, and checkpoints

Tasks 1–10 create and prove the complete workflow offline. Task 11 enables fal after those guarantees exist. Task 12 adds Replicate parity. Task 13 supplies optional richer local analysis; its absence must not break basic analysis or rendering. A future UI, transitions, subtitles, automatic lyric alignment, or hosted service needs a separate plan.

Task dependencies: `1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12`; Task 13 depends on Tasks 3 and 10. This ordering prioritizes a usable tested vertical slice; do not split infrastructure into disconnected modules without a command-level acceptance path.

No time estimates are promised. Completion is measured by each task's acceptance checks. Paid pilot readiness is the Task 11 exit gate; full-release acceptance includes Task 12. Each task ends with a focused commit after its checks pass. Product changes require review of the design first.

## File and interface map

Keep existing Arena files unchanged initially. Add a focused `src/studio/` tree so the legacy code cannot accidentally grant Studio paid execution or shell access. Extract shared helpers only when a task actually needs them; do not move the entire repository before building features.

| Path | Responsibility |
| --- | --- |
| `src/studio/domain.ts`, `schemas.ts`, `errors.ts` | Shared JSON domain types, Zod validators, stable error codes |
| `src/studio/project/{store,journal,lock,paths,init,archive}.ts` | Durable state, locking, safe project files, import/export |
| `src/studio/cli/{main,args,output,commands}.ts` | Command parsing, presentation, orchestration only |
| `src/studio/media/{process,probe,frames,download}.ts` | Controlled processes, media inspection, contact frames, streaming downloads |
| `src/studio/audio/{analyze,lyrics,timing}.ts` | Audio metadata and validated editable timing |
| `src/studio/creative/{bundle,prompt}.ts`, `storyboard/validate.ts` | Creative snapshots, prompt compilation, shot validation |
| `src/studio/approvals/{hash,policy}.ts` | Dependency hashes and approval enforcement |
| `src/studio/budget/{profiles,estimate,ledger}.ts` | Exact capabilities, cost quotes, reservations and settlement |
| `src/studio/generation/{provider,jobs,scheduler,recovery}.ts` | Provider contract, durable job lifecycle, recovery |
| `src/studio/providers/{fal,replicate,upload}.ts` | Network adapters only; no accounting decisions |
| `src/studio/review/{qc,contact-sheet,selection}.ts` | Technical reports, review artifacts, approved take selection |
| `src/studio/editing/{timeline,normalize,render,validate}.ts` | Deterministic edit and versioned export |
| `templates/new-project/` | Valid empty creative/storyboard/timeline templates |
| `config/model-profiles/` | Reviewed endpoint/capability/pricing definitions; no credentials |
| `tests/{project,audio,creative,approvals,budget,generation,providers,review,editing,cli}/` | Offline behavior and contract tests |
| `tests/helpers/`, `tests/fixtures/` | Temporary-project builders, fake network, synthetic-media recipes |
| `.agents/skills/music-video-producer/`, `docs/` | Operator workflow, creative handoffs, schema/provider references |

### Shared conventions

`ProjectPath` is an absolute string resolving within the configured projects root. `Hash` is lowercase SHA-256 hex. `UsdMicros` is a safe integer number, validated nonnegative. Serialized times are UTC ISO strings; timeline timing uses integer frames. Shared records named below (`Project`, `Shot`, `Take`, `Timeline`, `Job`, `Approval`, `Estimate`, `ModelProfile`, `AudioAnalysis`, `Timing`, `QcReport`, `RenderArtifact`) are schema-versioned types defined in `domain.ts`/`schemas.ts` as their owning tasks add them, following the design's fields.

`StudioError` has `code`, `message`, `details`, and `exitCode`; no provider payloads or secrets in messages. All service operations throw it on failure. Test excerpts below pin the required assertions; build each named test's setup in its owning test file with temporary directories, injected clock/fetch, and fixture records. They are implementation instructions, not tests already run.

## Task 1: Durable project state and safe mutation

**Files:** Create `src/studio/{domain,schemas,errors}.ts`, `src/studio/project/{store,journal,lock,paths}.ts`, `tests/project/{store,paths}.test.ts`, `tests/helpers/project.ts`; modify `package.json`, `tsconfig.json`, `.gitignore`.

**Interfaces:** `openProject(path: ProjectPath): Promise<ProjectStore>`; `ProjectStore.read(): Promise<ProjectState>`; `ProjectStore.mutate<T>(operation: (tx: Transaction) => Promise<T>): Promise<T>`; `Transaction.append(events: StudioEvent[]): Promise<void>`; `resolveProjectPath(root: string, id: string): Promise<ProjectPath>`; `resolveAsset(path: ProjectPath, relative: string): Promise<string>`. `ProjectState` carries journal sequence plus jobs, approvals, commitments, selections, and stage; event variants are added by owning tasks.

- [ ] **Write failing tests** `atomic_replay`, `reject_concurrent_mutator`, `detect_incomplete_tail`, `reject_corrupt_complete_line`, `reject_future_schema`, `reject_traversal_and_symlink`. Create a transaction, reopen it, inject truncated tails, and hold one live lock while a second process attempts mutation. Required assertions:
  ```ts
  assert.equal(reopened.sequence, 1);
  assert.equal(competingError.code, 'PROJECT_BUSY');
  assert.equal(partialError.code, 'RECOVERY_REQUIRED');
  assert.equal(futureError.code, 'UNSUPPORTED_SCHEMA');
  assert.equal(escapeError.code, 'PATH_OUTSIDE_PROJECT');
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/project/store.test.ts tests/project/paths.test.ts` fails because the Studio modules do not exist.
- [ ] **Implement storage contracts.** Persist one fsynced journal transaction per line with monotonic sequence; replay complete valid transactions. Use exclusive create for the lock, PID/host ownership, and temporary-file rename for projections. `mutate` owns the command's lock; each `tx.append(events)` durably writes one complete transaction before returning, so an intent can be flushed before a network effect while the lock remains held. A transaction contains related job/budget changes together. `ProjectStore.read()` never clears files. Add a test helper `makeProject(root: string, id?: string): Promise<ProjectPath>` that creates only test fixtures, not production initialization.
- [ ] **Add tooling with this deliverable:** set Node engine >=24; add `test` using `node --import tsx --test` and explicit test globs at each populated directory, and `test:media` for the separate media suite. Include `tests/**/*.ts` in typecheck. Ignore `projects/`, `.studio-cache/`, partial media, `.venv/`, and Python caches while keeping synthetic fixture recipes tracked. Update the lockfile only through npm for actual package changes.
- [ ] **Verify green:** rerun focused tests and `npm run typecheck`; expect zero failures. Terminate a test child process between journal append and projection refresh; reopen must recover the same sequence and commitments.
- [ ] **Commit:** `feat: add durable Studio project state`.

## Task 2: Project initialization, environment checks, and CLI boundary

**Files:** Create `src/studio/project/init.ts`, `src/studio/cli/{main,args,output,commands}.ts`, `src/studio/media/process.ts`, `templates/new-project/`, `tests/cli/{init,doctor,args}.test.ts`; modify `package.json`, `README.md`, `.env.example`.

**Interfaces:** `runCli(argv: string[], dependencies: CliDependencies): Promise<number>`; `initProject(root: string, input: {id:string;audioPath:string;lyricsPath?:string}): Promise<Project>`; `runMedia(binary:'ffmpeg'|'ffprobe', args:string[], opts:{cwd:ProjectPath;signal?:AbortSignal}): Promise<{stdout:string;stderr:string}>`; `doctor(): Promise<DoctorReport>`. CLI dispatch will grow as services become available; it must never import Arena `run.ts`.

- [ ] **Write failing tests** `init_copies_inputs_without_overwrite`, `init_rolls_back_partial_copy`, `doctor_reports_missing_binary`, `unknown_flag_is_error`, and `json_errors_are_stable`. Use paths containing spaces, quotes, semicolons, and dollar signs; verify no shell evaluation and no writes outside the new project. Assert:
  ```ts
  assert.equal(result.project.schemaVersion, 1);
  assert.equal(originalInputHash, copiedInputHash);
  assert.equal(secondInitError.code, 'PROJECT_EXISTS');
  assert.equal(jsonError.error.code, 'INVALID_ARGUMENT');
  assert.equal(exitCode, 2);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/cli/init.test.ts tests/cli/doctor.test.ts tests/cli/args.test.ts` fails on missing exports.
- [ ] **Implement import and CLI.** Copy input media under immutable safe filenames, record original display names and SHA-256, initialize project/journal/templates atomically, and clean only the incomplete new directory on failure. No default budget approval. `doctor` reports Node, FFmpeg encoders/filters, FFprobe, writable media root, and configured provider availability without printing keys. Launch subprocesses with `shell:false`, bounded output/time, and no provider credentials in media-process environments.
- [ ] **Add `studio: tsx src/studio/cli/main.ts`.** Retain legacy code as `arena` and make `start` show Studio help when migrating the package; document the explicit paid legacy command. Studio help, status, and analysis must not require an LLM/provider key. Keep real keys only in ignored environment files.
- [ ] **Verify green:** focused tests, `npm run typecheck`, `npm run studio -- --help`, `npm run studio -- doctor --json`. Doctor must report missing dependencies truthfully; CI tests mock those conditions, and an operator installs FFmpeg separately before media acceptance.
- [ ] **Commit:** `feat: initialize persistent Studio projects`.

## Task 3: Audio truth, lyrics import, and editable timing

**Files:** Create `src/studio/media/probe.ts`, `src/studio/audio/{analyze,lyrics,timing}.ts`, `tests/audio/{analysis,lyrics,timing}.test.ts`, `tests/fixtures/audio/`; extend domain/schema and CLI commands.

**Interfaces:** `probeAudio(path:string): Promise<AudioAnalysis>`; `parseLyrics(text:string, format:'lrc'|'json'|'txt', durationSec:number): Timing['lyrics']`; `analyzeProject(path:ProjectPath, opts:{engine:'basic'|'librosa';timingPath?:string}): Promise<{audio:AudioAnalysis;timing:Timing}>`. `AudioAnalysis` includes original hash, durationSamples, sampleRate, channels and durationSec; `Timing` includes source-tagged lyrics/beats/sections and `verified` flags.

- [ ] **Write failing tests** `instrumental_without_lyrics`, `plain_lyrics_not_marked_aligned`, `lrc_offsets_and_repeated_timestamps`, `invalid_timing_rejected`, `fractional_duration_preserved`. LRC supports `[offset:ms]`, metadata lines, multiple timestamps for a line, and repeated chorus text; group equal timestamps as simultaneous lyrics rather than dropping them. Assert:
  ```ts
  assert.equal(plain.lyrics[0]?.verified, false);
  assert.equal(instrumental.lyrics.length, 0);
  assert.equal(outOfRange.code, 'INVALID_TIMING');
  assert.equal(Math.ceil(audio.durationSec * 24), expectedTotalFrames);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/audio/analysis.test.ts tests/audio/lyrics.test.ts tests/audio/timing.test.ts`.
- [ ] **Implement basic analysis.** Read stream duration/sample information with typed FFprobe errors, parse timed JSON/LRC, preserve raw text, validate finite nonnegative ordered timings within duration, and accept explicit human timing corrections with provenance. Basic mode never fabricates tempo, sections, or lyric alignment. New analysis hashes invalidate dependent storyboard approvals through Task 5's policy.
- [ ] **Verify green:** focused tests and typecheck. Missing/corrupt audio must fail before creative approval or paid scheduling; timestamps at the exact audio end may close an interval but may not start a positive-duration lyric.
- [ ] **Commit:** `feat: analyze source audio and import lyric timing`.

## Task 4: Creative bundle, shot schema, and deterministic prompts

**Files:** Create `src/studio/creative/{bundle,prompt}.ts`, `src/studio/storyboard/validate.ts`, `tests/creative/{bundle,storyboard,prompt}.test.ts`; extend templates, domain/schema, CLI `validate`.

**Interfaces:** `loadCreative(path:ProjectPath): Promise<CreativeBundle>`; `validateStoryboard(shots:Shot[], audio:AudioAnalysis, profiles:ModelProfile[]): ValidationReport`; `compilePrompt(bundle:CreativeBundle, shot:Shot, profile:ModelProfile): CompiledInput`. `CreativeBundle` contains versioned documents, character/location definitions and reference hashes; `CompiledInput` contains prompt, local reference descriptors, normalized parameters and input hash, never an uploaded URL yet.

- [ ] **Write failing tests** `three_concept_template`, `reuse_character_and_location`, `reject_unknown_reference`, `reject_gap_overlap_and_duplicate_id`, `reference_edit_changes_input_hash`, `model_duration_capability_rejected`. A 72-frame test song has `[0,24)`, `[24,72)` coverage; a gap at frame 24 must fail. Assert:
  ```ts
  assert.equal(validReport.ok, true);
  assert.equal(gapReport.errors[0]?.code, 'TIMELINE_GAP');
  assert.notEqual(before.inputHash, afterReferenceEdit.inputHash);
  assert.equal(compiled.prompt.includes(character.description), true);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/creative/bundle.test.ts tests/creative/storyboard.test.ts tests/creative/prompt.test.ts`.
- [ ] **Implement validated templates and pure prompt compilation.** Include concept, style, motifs, camera and all referenced identities. Require full contiguous frame coverage and exact profile support; normalize JSON canonically before hashing. Do not infer approval from Markdown or a mutable `status` field. Profile schema is completed in Task 6; use explicit typed test profiles here.
- [ ] **Verify green:** focused tests/typecheck and `studio validate` on one valid and one broken fixture. Prompts and parameter snapshots must be stable across process restarts.
- [ ] **Commit:** `feat: define creative bundles and reproducible shot inputs`.

## Task 5: Content-bound approval gates

**Files:** Create `src/studio/approvals/{hash,policy}.ts`, `tests/approvals/policy.test.ts`; extend domain/schema, journal events, CLI `approve`/`status`.

**Interfaces:** `approvalTarget(path:ProjectPath, target:ApprovalTarget): Promise<{hash:Hash;dependencies:Record<string,Hash>}>`; `recordApproval(store:ProjectStore, request:{target:ApprovalTarget;expectedHash:Hash;actor:string;estimateCaps?:{lifetimeCapMicros:UsdMicros;scopeCapMicros:UsdMicros}}): Promise<Approval>`; `requireApproval(state:ProjectState, target:ApprovalTarget, currentHash:Hash): Approval`. `ApprovalTarget` discriminates creative with required scope, storyboard, estimate ID, pilot render ID, take ID, or final render ID. `GenerationScope` is references|pilot|production. CLI creative approval requires `--scope`; target hash resolves the matching concrete artifact ID without choosing the latest artifact implicitly.

- [ ] **Write failing tests** `reject_stale_hash`, `reference_scope_has_no_circular_gate`, `production_requires_current_pilot`, `retrieve_allowed_after_edit`, `unselected_take_does_not_stale_pilot`. Change a character description after approval and assert:
  ```ts
  assert.equal(submissionError.code, 'APPROVAL_STALE');
  assert.equal(providerPostCount, 0);
  assert.equal(referencePreflight.ok, true);
  assert.equal(productionError.code, 'PILOT_APPROVAL_REQUIRED');
  assert.equal(retrieveAllowed, true);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/approvals/policy.test.ts`.
- [ ] **Implement the design's scope matrix and stage derivation.** Hash dependency bytes, not filenames/mtime. Verify expected hashes under the mutation lock to prevent approval/edit races. Record actor and sequence. Approval never rewrites creative files; dependencies make stale records ineffective. Estimate approval must carry nonnegative caps and cannot hide existing liabilities. Render/take targets gain their concrete artifacts in Tasks 8–9.
- [ ] **Verify green:** focused tests/typecheck; fixture CLI status explains each missing/stale approval and its affected shots. Batch approval must authorize routine work without further per-clip prompts.
- [ ] **Commit:** `feat: enforce versioned creative and production approvals`.

## Task 6: Exact profiles, estimates, and atomic budget reservations

**Files:** Create `src/studio/budget/{profiles,estimate,ledger}.ts`, `tests/budget/{profiles,estimate,ledger}.test.ts`, `tests/fixtures/profiles/`; extend journal/domain/schema and CLI `estimate`/`reconcile`.

**Interfaces:** `loadProfiles(directory:string, now:Date): Promise<ModelProfile[]>`; `estimateOperations(ops:GenerationOperation[], profiles:ModelProfile[], scope:GenerationScope): Estimate`; `reserve(tx:Transaction, request:{jobId:string;estimateId:string;operationId:string;allowanceMicros:UsdMicros}): Promise<Reservation>`; `settle(tx:Transaction, request:{jobId:string;eventId:string;kind:'estimated'|'actual'|'released';amountMicros:UsdMicros;evidenceHash?:Hash}): Promise<void>`. `GenerationOperation` contains unique ID, shot/reference target, compiled input, profile ID and billable dimensions/duration.

- [ ] **Write failing tests** `no_unknown_price_fallback`, `reject_expired_price`, `round_billable_duration`, `reservation_race`, `download_failure_keeps_charge`, `duplicate_settlement_is_idempotent`, `overrun_halts_new_paid_work`. Use fixture-only rates; with cap 10,000,000, spent 6,000,000 and held 3,000,000, reserve 2,000,000 must fail. Assert:
  ```ts
  assert.equal(error.code, 'BUDGET_EXCEEDED');
  assert.equal(state.spentMicros + state.heldMicros, 9_000_000);
  assert.equal(unknownPrice.code, 'MODEL_PRICE_UNVERIFIED');
  assert.equal(duplicateSettledState.spentMicros, onceSettledState.spentMicros);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/budget/profiles.test.ts tests/budget/estimate.test.ts tests/budget/ledger.test.ts`.
- [ ] **Implement strict profile schemas and cost math.** Explicit formula discriminators cover per-image, per-generated-second, per-generation, and bounded token/pixel quantities only when verified. Reject unsupported profiles; no regex guessing. Bind quote to exact inputs, price versions, scopes and operation IDs. Use decimal-string USD conversion with ceil-to-microdollar rounding. Show base estimate, maximum reserved allowance, spent, held, and remaining separately.
- [ ] **Implement journal accounting.** Combine reservation/job intent in one transaction, enforce both project lifetime cap and scope allowance, consume an operation authorization once, and require a new estimate for an explicit additional take. Estimated charges can be replaced by actual evidence without double counting; release only with documented no-charge evidence. Record overruns even when they exceed authorization and halt submissions. Rebuild cost-ledger projection from journal.
- [ ] **Verify green:** tests/typecheck, concurrent child-process race, and fixture `studio estimate --json`. None of these tests use provider credentials or network.
- [ ] **Commit:** `feat: reserve and reconcile generation budgets durably`.

## Task 7: Fake-provider production engine and crash recovery

**Files:** Create `src/studio/generation/{provider,jobs,scheduler,recovery}.ts`, `src/studio/media/download.ts`, `tests/helpers/{fake-provider,fake-fetch}.ts`, `tests/generation/{jobs,recovery,scheduler,download}.test.ts`; extend CLI `generate`/`resume`/`cancel`/`recover`.

**Interfaces:** `GenerationProvider.submit(input:ProviderInput, signal?:AbortSignal): Promise<ProviderHandle>`; `.status(handle:ProviderHandle): Promise<ProviderStatus>`; `.result(handle:ProviderHandle): Promise<ProviderOutput>`; `.cancel(handle:ProviderHandle): Promise<CancelAcknowledgment>`; `.upload(asset:ReferenceAsset): Promise<UploadedReference>`. Handle pins provider, model, requestId and validated status/result/cancel URLs. Status is pending|running|succeeded|failed|canceled; output has typed asset descriptors, not recursively collected URLs.

`generate(path:ProjectPath, request:{scope:GenerationScope;estimateId:string;shotId?:string;referenceId?:string;newTake?:boolean;dryRun?:boolean}, providers:ProviderRegistry): Promise<Job[]>`; `resumeJobs(path:ProjectPath, providers:ProviderRegistry, attach?:{jobId:string;requestId:string}): Promise<Job[]>`; `downloadAsset(asset:ProviderAsset, destination:string, opts:DownloadPolicy): Promise<{path:string;hash:Hash}>`. `ProviderRegistry` maps provider IDs to adapters; fake registry is injected in tests only, never a selectable production endpoint. CLI requires `--estimate`; the named quote determines operations and pilot interval, and requested target filters must match it exactly.

- [ ] **Write failing tests** `persist_intent_before_post`, `recover_saved_request_id`, `accepted_but_unpersisted_is_unknown`, `resume_download_without_post`, `running_jobs_count_against_limit`, `explicit_new_take_preserves_old_take`, `blocked_url_redirect_and_oversize`, `partial_journal_recovery_preserves_backup`. Add process-kill hooks at each boundary. Assert:
  ```ts
  assert.equal(afterCrash.jobs[0]?.state, 'submission-unknown');
  assert.equal(resumePostCount, 0);
  assert.equal(afterCrash.heldMicros, originalAllowanceMicros);
  assert.equal(maxObservedActiveJobs <= 2, true);
  assert.equal(downloadRetryPostCount, 0);
  assert.equal(oldTakeHashAfterRetry, oldTakeHashBeforeRetry);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/generation/jobs.test.ts tests/generation/recovery.test.ts tests/generation/scheduler.test.ts tests/generation/download.test.ts`.
- [ ] **Implement lifecycle and scheduler.** Read one consistent creative/input snapshot, validate/hash it, then gate and reserve under lock against that same persisted request snapshot; fsync submitting intent; submit once; save handle immediately; then bounded polling/retrieval. Later external file edits cannot alter already-snapshotted provider parameters. Unknown outcomes retain holds. GET/download retries use 5 attempts, 1–16s exponential backoff and bounded Retry-After; default paid POST retries are zero. Inject clock, delays, fetch and abort signals for deterministic tests. Dry-run returns validated operations and gates without reservations, uploads or POSTs.
- [ ] **Implement download/recovery.** Stream max 2 GiB to `.partial`, validate hosts/redirects, probe/decode output, hash and promote. Reference uploads are represented separately from local file paths and can be refreshed. Explicit attach verifies configured account/model before use. Recover only an incomplete tail with backup; never silently discard a valid event or release unknown charges. Local abort leaves provider state queryable; cancellation acknowledgment is not proof of refund.
- [ ] **Verify green:** focused tests/typecheck and an offline fixture progression from intent to ready, interrupted once during polling and once during download. Every provider effect must be observable through fake call counters.
- [ ] **Commit:** `feat: orchestrate resumable versioned generation jobs`.

## Task 8: Technical review, contact sheets, and take selection

**Files:** Create `src/studio/media/frames.ts`, `src/studio/review/{qc,contact-sheet,selection}.ts`, `tests/review/{qc,selection}.test.ts`, `tests/media/review.test.ts`; extend CLI `review`/`select`.

**Interfaces:** `reviewTake(path:ProjectPath, takeId:string): Promise<QcReport>`; `buildContactSheet(path:ProjectPath, takeIds:string[]): Promise<string>`; `selectTake(store:ProjectStore, request:{shotId:string;takeId:string;draft?:boolean}): Promise<Timeline>`. QC has machine-checkable findings plus separately authored creative notes. Technical pass is required for take approval; ordinary selection requires that take's current approval. Explicit `--draft` permits a technically valid take for pilot review only and cannot replace an approved selection; final export rejects draft selections.

- [ ] **Write failing tests** `corrupt_video_fails_qc`, `short_clip_fails_qc`, `selection_requires_approval`, `draft_pilot_selection_cannot_replace_approved_take`, `selection_does_not_delete_previous_take`, `replacement_stales_dependent_final`. Assert:
  ```ts
  assert.equal(shortReport.findings.some(f => f.code === 'CLIP_TOO_SHORT'), true);
  assert.equal(unapprovedSelection.code, 'TAKE_APPROVAL_REQUIRED');
  assert.equal(previousTakeStillExists, true);
  assert.notEqual(oldTimelineHash, replacementTimelineHash);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/review/qc.test.ts tests/review/selection.test.ts`.
- [ ] **Implement review and selection.** Extract 3 evenly spaced labeled frames per video; image references get image validation instead. Write human-readable HTML contact sheets and JSON reports as local files without remote scripts. Treat shot descriptions/notes as escaped text. Store notes independently and never infer approval from notes. Selection appends an event and creates an explicit timeline revision; old takes/renders remain immutable. Draft pilot selection may use technically valid takes, but final timeline selection needs approved takes.
- [ ] **Verify green:** unit tests/typecheck plus `node --import tsx --test tests/media/review.test.ts` with installed FFmpeg. Visually inspect one contact sheet and verify displayed IDs match fixture takes; missing FFmpeg is a reported dependency failure, not a skipped passing acceptance check.
- [ ] **Commit:** `feat: review and select immutable shot takes`.

## Task 9: Deterministic pilot and final render

**Files:** Create `src/studio/editing/{timeline,normalize,render,validate}.ts`, `tests/editing/{timeline,render-plan}.test.ts`, `tests/media/render.test.ts`, `tests/fixtures/media/README.md`; extend CLI `pilot`/`render` and render approvals.

**Interfaces:** `compileTimeline(project:Project, shots:Shot[], takes:Take[], selections:Selection[]): Timeline`; `renderProject(path:ProjectPath, request:{preset:'pilot'|'final';startSec?:number;durationSec?:number}): Promise<RenderArtifact>`; `validateRender(path:string, expected:RenderExpectation): Promise<QcReport>`. RenderArtifact includes render ID, path/hash, exact timeline/dependency hashes, format and QC. RenderExpectation pins frame count, audio source hash/sample range and stream properties.

- [ ] **Write failing tests** `absolute_frame_boundaries_do_not_drift`, `short_source_clip_rejected`, `pilot_crops_matching_audio`, `full_duration_and_original_soundtrack`, `failed_render_keeps_approved_export`, `mixed_fps_and_portrait_clips`. Use a 10.013-second generated source tone and clips with conflicting embedded tones. Assert:
  ```ts
  assert.equal(timeline.totalFrames, 241);
  assert.equal(videoStream.width, 1920);
  assert.equal(videoStream.height, 1080);
  assert.equal(videoStream.avg_frame_rate, '24/1');
  assert.equal(audioStreamCount, 1);
  assert.equal(approvedExportHashAfterFailedRender, originalApprovedExportHash);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/editing/timeline.test.ts tests/editing/render-plan.test.ts`.
- [ ] **Implement frame-based conformance.** Derive all cuts from absolute frames; trim longer clips, reject short ones, normalize dimensions with preserved aspect/padding and fps/SAR/pixel format. Concatenate video-only segments using controlled filenames and arguments, explicitly map original audio at matching sample bounds, encode to new render ID. No implicit retiming, `-shortest`, transitions or provider audio. Keep duration coverage within design tolerances.
- [ ] **Implement export validation.** Fully decode audio/video, count frames, inspect codecs/streams, check non-truncation and sample-range provenance, then expose only successful exports. Automated audio test compares decoded tone/correlation against the original reference and rejects the generated clip tone; byte identity is inappropriate after AAC encoding. Final export requires current approvals for every selected take and current creative/storyboard/pilot gates. A successful render is not human final approval.
- [ ] **Verify green:** focused tests/typecheck and `node --import tsx --test tests/media/render.test.ts`; manually view the synthetic pilot at start, cuts and final frame. Render twice from the same manifest and assert matching timeline/input hashes and stream properties; do not require identical MP4 bytes across tool versions.
- [ ] **Commit:** `feat: render validated pilots and full-song exports`.

## Task 10: Offline production walkthrough, archive, and operator handoff

**Files:** Create `src/studio/project/archive.ts`, `tests/cli/{workflow,archive}.test.ts`, `.github/workflows/ci.yml`, `docs/{architecture,production-workflow,creative-guidelines,provider-models,data-schemas}.md`, `.agents/skills/music-video-producer/SKILL.md` with references; update root `AGENTS.md`, README, `.env.example`, `STUDIO.md`, package metadata.

**Interfaces:** `archiveProject(path:ProjectPath, outputDirectory:string): Promise<{path:string;manifestHash:Hash}>`. Add CLI `archive`; reopening the copied project through `openProject` is restore, with source hash checks and a new lock. Archive excludes lock files and credential/signed-response material; includes source/media/journal/takes and integrity manifest, and refuses a destination inside the source tree.

- [ ] **Write failing tests** `two_project_offline_workflow`, `regenerate_only_s014`, `restart_resume_and_render`, `archive_reopens_without_secrets`. Exercise all commands through `runCli` with fake providers and synthetic media, including reference scope before pilot. Assert:
  ```ts
  assert.equal(projectA.id === projectB.id, false);
  assert.deepEqual(unaffectedTakeHashesAfter, unaffectedTakeHashesBefore);
  assert.equal(restoredState.sequence, archivedState.sequence);
  assert.equal(archiveContainsSecrets, false);
  assert.equal(finalApproval.targetHash, successfulFinalRender.hash);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/cli/workflow.test.ts tests/cli/archive.test.ts`.
- [ ] **Complete command wiring and documentation.** Document creative artifact handoff, three concepts, instrumental/plain/timed lyrics, approvals, scope caps, lost-request recovery, failed downloads, overrun handling, take selection, final review, archive/restore and installation on Mac. Producer skill must inspect status, use only implemented commands, preserve takes, and require explicit human authorization before recording approvals, increasing budgets or publishing. No implicit shared chat memory or required LLM API key. Use skill-creator/writing-skills instructions when actually creating this skill during implementation.
- [ ] **Add CI and offline fixtures.** Run Node 24 and the current supported Node line, install FFmpeg in the media job, `npm ci`, typecheck, offline unit/contract/CLI tests, and media integration tests without credentials. CI must never invoke `arena` or a real generation endpoint. A separate manually invoked smoke procedure handles paid production.
- [ ] **Verify green:** `npm run typecheck`, `npm test`, `npm run test:media`, `npm run studio -- --help`; run documented offline walkthrough from a fresh temporary project with both fake adapters. Validate skill links and every documented command against help. This is the offline milestone exit gate, not a claim that real provider integration is complete.
- [ ] **Commit:** `feat: deliver offline Studio production workflow and handoff`.

## Task 11: fal queue, verified model profiles, and approved paid pilot

**Files:** Create `src/studio/providers/{fal,upload}.ts`, `config/model-profiles/{fal-image,fal-video}.json`, `tests/providers/{fal,uploads}.test.ts`, `docs/provider-smoke-test.md`; wire production ProviderRegistry.

**Interfaces:** `createFalProvider(config:{apiKey:string;fetch:typeof fetch}): GenerationProvider`; `uploadReference(provider:'fal'|'replicate', asset:ReferenceAsset): Promise<UploadedReference>`. Provider secrets are read at command execution and never persisted in the project. Adapter output parsing/capabilities bind to reviewed profile IDs, not arbitrary raw endpoints.

- [ ] **Write failing HTTP contract tests** `submit_returns_persistable_handle`, `queue_status_and_result`, `error_payload_is_sanitized`, `reference_upload_refresh`, `malicious_status_url_rejected`, `cancel_does_not_release_hold`, `ambiguous_post_not_retried`. Mock fetch using captured schema-shaped fixtures; assert:
  ```ts
  assert.equal(handle.requestId, 'fixture-request-1');
  assert.equal(postAttempts, 1);
  assert.equal(secretInLogs, false);
  assert.equal(referenceInputUsesLocalFilePath, false);
  assert.equal(heldAfterCancelRequest, heldBeforeCancelRequest);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/providers/fal.test.ts tests/providers/uploads.test.ts`.
- [ ] **Implement separate queue operations and uploads.** Consult current [fal queue documentation](https://fal.ai/docs/documentation/model-apis/inference/queue) and the selected model's API/pricing pages. Validate operation URLs/redirects before adding authorization. Define one image and one reference-capable video profile with exact schemas, output fields, supported durations/resolutions, price source/date/expiry and upper-charge assumptions. If an endpoint cannot support bounded pricing, leave it disabled. Profile verification is a prerequisite for paid submission, not a hardcoded recommendation in this plan.
- [ ] **Verify offline green:** contract tests, full offline suite and typecheck. `doctor` shows real credential availability without values. Prove `generate --dry-run` performs no network uploads or POSTs.
- [ ] **Run real smoke only after explicit user approval:** choose a user's song/reference, record creative/storyboard/estimate approvals with a user-selected dollar cap, generate a short pilot, interrupt/resume polling, download, review and render. Record actual endpoint/profile versions, request IDs, allowance/spend, output QC and observed provider billing evidence in ignored project files. No paid call is authorized by this plan itself; if keys/funds are absent, mark this smoke gate pending, not passed.
- [ ] **Commit:** `feat: add durable fal production adapter` after offline checks; document separately whether the paid smoke gate passed or remains pending.

## Task 12: Replicate parity and adapter switching

**Files:** Create `src/studio/providers/replicate.ts`, `config/model-profiles/{replicate-image,replicate-video}.json`, `tests/providers/{replicate,contract}.test.ts`; extend uploads and provider docs.

**Interfaces:** `createReplicateProvider(config:{apiToken:string;fetch:typeof fetch}): GenerationProvider`. Same adapter contract and ledger as Task 11. Switching profile creates a new quote/take authorization; existing jobs remain bound to their original provider/model version.

- [ ] **Write failing tests** `persist_prediction_id`, `official_vs_versioned_endpoint`, `starting_processing_succeeded`, `failed_canceled_and_expired_output`, `resume_gets_existing_prediction`, `provider_switch_invalidates_estimate`. Run shared lifecycle contract against both adapters. Assert:
  ```ts
  assert.equal(handle.requestId, 'fixture-prediction-1');
  assert.equal(resumeCreateCount, 0);
  assert.equal(changedProviderError.code, 'ESTIMATE_STALE');
  assert.equal(oldJob.handle.provider, 'fal');
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/providers/replicate.test.ts tests/providers/contract.test.ts`.
- [ ] **Implement asynchronous prediction operations** using the documented official/versioned endpoints; persist ID immediately, parse model-specific outputs, validate owner/model during attach, and handle output expiry without paid regeneration. Pin exact profiles and verify pricing/upload semantics against current [Replicate documentation](https://replicate.com/docs/topics/predictions/create-a-prediction). Reuse accounting, scheduler and recovery; do not fork those policies per provider.
- [ ] **Verify green:** shared adapter contract, typecheck, full offline and media suites, two-project scenario using different fake adapters. A real Replicate smoke requires its own explicit budget approval; never silently fall back from fal to Replicate on failure.
- [ ] **Commit:** `feat: add resumable Replicate generation parity`.

## Task 13: Optional local musical analysis

**Files:** Create `scripts/analyze_audio.py`, `requirements-analysis.txt`, `tests/audio/librosa.test.ts`, `tests/python/test_analyze_audio.py`; extend `src/studio/audio/analyze.ts`, analysis schema/docs, doctor and optional CI job.

**Interfaces:** Python CLI `python scripts/analyze_audio.py --audio <file> --output <json>`; output matches `Timing` beat/onset/section suggestion fields with source, confidence and tool versions. TypeScript invokes it through controlled subprocess arguments and imports validated data. `analyze --engine basic` remains independent of Python.

- [ ] **Write failing tests** `click_track_estimates_beats`, `silence_returns_uncertain`, `rubato_does_not_claim_verified_grid`, `manual_corrections_survive_reanalysis`, `missing_python_only_blocks_optional_engine`. For a synthetic 120 BPM click track, assert median inter-beat interval within 0.05 seconds of 0.5; never assert exact timestamps for arbitrary songs. Also assert:
  ```ts
  assert.equal(silence.tempoBpm, null);
  assert.equal(manualAfterReanalysis, manualBeforeReanalysis);
  assert.equal(basicModeRequiresPython, false);
  ```
- [ ] **Confirm red:** `node --import tsx --test tests/audio/librosa.test.ts` and `python -m unittest discover -s tests/python` fail before the worker exists.
- [ ] **Implement offline estimates** with a pinned compatible librosa/Python dependency set verified at execution time. Produce beats/onsets, energy windows and heuristic section suggestions; preserve human correction overlays instead of overwriting them. Use actual sample-rate/time conversion; do not time-stretch the original song. Automatic lyric transcription/forced alignment remains outside this milestone.
- [ ] **Verify green:** optional Python and TypeScript tests, basic suite in an environment without Python, and a manual comparison on one real song. Document that musical and lyric timing still need creative review; suggestions do not approve a storyboard.
- [ ] **Commit:** `feat: add optional local rhythm and section analysis`.

## Completion evidence and handoff

- [ ] Every design goal maps to a task: projects/storage 1–2, analysis 3/13, creative/storyboard 4, gates 5, budget 6, resumability 7/11/12, review/regeneration 8/10, pilot/final audio 9/10, producer skill/archive 10.
- [ ] Inspect Studio's import graph: no `src/agent.ts`, `src/tools/run-command.ts`, legacy generation tools or `src/budget.ts` reachable from CLI.
- [ ] Record exact command outputs for typecheck, unit/contract/CLI tests and media tests; record missing prerequisites and paid smoke status separately.
- [ ] Demonstrate two projects, single-shot replacement, safe recovery and final export from the documented walkthrough.
- [ ] Preserve upstream license and provenance; confirm user fork `origin` and source `upstream` before any push. Do not push to the upstream author's repository.
- [ ] Review the plan/design with the user before building. Native inline execution is the recommended default because tasks share storage, approval and accounting contracts; delegated execution remains an option if the user prefers its additional review overhead.

## Planning self-review

Spec coverage, type/interface naming, five review-focus cases, and command-to-task ownership were checked when writing this plan. Known proposed scope decisions are explicit in the design: CLI first, local journal, hard-cut 24 fps output, no required internal LLM, timed lyrics/manual correction first, and provider/model selection deferred until verified. The paid smoke is an external validation gate, not a test silently included in CI. No implementation test results are claimed by this planning document.
