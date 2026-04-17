# TypeScript Cut-over Plan

## Snapshot

- [x] Confirm historical upstream Python baseline branch: `master`
- [x] Confirm historical upstream Python baseline commit: `ed9a06c`
- [x] Confirm historical upstream Python baseline version: `1.2.1`
- [x] Confirm the historical migration workspace: `ts/`
- [x] Inspect `../graphify` as the reference model for a root-level npm-only package
- [x] Confirm the GitHub repository is still a fork of `SYSTRAN/faster-whisper`
- [x] Verify current validation evidence for the root-level npm package:
  - [x] `npm run build`
  - [x] `npm test`
  - [x] `NPM_CONFIG_CACHE=/tmp/faster-whisper-npm-cache npm run pack:check`
- [x] Add and validate a pristine tarball install smoke test
- [x] Verify GitHub Actions on the migrated repository
  - [x] `TypeScript CI` is active on GitHub
  - [x] run `24485316095` succeeded on `master`
  - [x] run `24485580650` succeeded on `typescript`
  - [x] run `24487017706` succeeded on detached `typescript` via `workflow_dispatch`
- [x] Verify whether everything has been committed
- [x] Working tree is fully committed
  - Current result: `git status --short --branch` is clean after the final leftover-cleanup commit
  - Current result: the branch now contains the full ordered cut-over history
- [x] `.codex` is ignored
- [x] Local migration leftovers are removed from disk
  - Current result: `ts/`, `faster_whisper/`, `benchmark/`, and `docker/` were removed locally after the root cut-over
  - Current result: `graphify-out/` is intentionally kept as a local ignored output directory
  - Current result: pristine tarball install and fresh-clone `npm ci` / `npm run build` now pass in `/tmp/faster-whisper-release-check`
- [x] Establish continuity branches before detaching the fork
  - [x] `python-origin` points to `ed9a06c`
  - [x] `typescript` points to the npm-only branch tip
- [x] Do not publish the detached TypeScript line as stable `1.2.1` until parity is implemented and validated
  - [x] npm package version was kept at `0.1.0` for the non-parity line
  - [x] npm package version is bumped to `1.2.1` after the parity matrix passed
- [x] Document the current npm line as a scoped stable parity line
  - [x] README explicitly lists the supported scope and remaining runtime/platform limits for stable `v1.2.1`
  - [x] parity implementation work is tracked below instead of being implied away
- [x] Detach the GitHub repository from the upstream fork network
  - [x] backup mirror created in `/tmp/faster-whisper.detach-backup.git`
  - [x] `rhanka/faster-whisper` recreated as a standalone repository
  - [x] default branch switched to `typescript`

## Guardrails

- [x] Keep this file as the execution source of truth for the repo cut-over
- [x] Keep the migration target as a **root-level npm-only package**, modeled after `../graphify`
- [x] Keep the repository on a permissive free-software license model
- [x] Plan to preserve and acknowledge the original `SYSTRAN/faster-whisper` work explicitly
- [x] Treat phases 1 to 5 as already implemented at smoke-test level, not yet fully industrialized
- [x] Do not claim full parity in documentation until the automated parity matrix exists
- [x] Create a first explicit checkpoint commit for the current TypeScript migration before destructive moves
- [x] Do not delete Python files until the root-level npm package builds and tests successfully from repo root
- [x] Eliminate all hard-coded absolute local paths before calling the package releasable
- [x] Keep `python-origin` as the frozen Python continuity branch until an explicit realignment plan exists
- [x] Do not publish or tag stable `v1.2.1` until the TypeScript port reaches parity with Python `1.2.1`
- [x] Use `0.x` only for a clearly labeled non-parity preview line if any preview is published before parity

## Remaining Order

1. [x] Remove local leftovers that still make the repo look hybrid
   - [x] ignore `graphify-out/`
   - [x] keep the physical `graphify-out/` directory ignored as local output
   - [x] remove the physical `ts/` directory now that root files are in place
   - [x] remove the leftover legacy directories and binary remnants under `faster_whisper/`, `benchmark/`, and `docker/`
2. [x] Finish the release-surface decisions for the npm-only repo
   - [x] remove the Python-only `benchmark/` surface from the npm-only repository
   - [x] remove the Python-only `docker/` surface from the npm-only repository
   - [x] decide whether prebuilt native binaries are deferred or planned
3. [x] Stabilize the transcription layer beyond the current smoke proof
   - [x] review and replace the remaining simplified/POC logic in `src/transcribe.ts`
   - [x] align the code and tests with the newly documented supported/deferred option surface
   - [x] broaden model coverage beyond the single tiny-model smoke path
4. [x] Finish documentation parity for the npm-only port
   - [x] expand the README section coverage
   - [x] add release and publishing notes
5. [x] Establish the branch and version mapping for the detached TypeScript line
   - [x] create `python-origin`
   - [x] create `typescript`
   - [x] reserve stable `v1.2.1` for parity
   - [x] bump the stable parity npm package to `1.2.1`
6. [ ] Detach the GitHub fork and promote `typescript` as the primary branch
   - [x] break the current fork relationship on GitHub
   - [x] switch the default branch from `master` to `typescript`
7. [ ] Re-run CI on the release-shaped branch tip and publish
   - [x] expand GitHub Actions triggers to include `typescript`
   - [x] verify GitHub Actions on the detached `typescript` branch
   - [x] decide not to tag/publish stable `v1.2.1` before parity
   - [x] tag stable `v1.2.1`
   - [x] add automatic npm publishing after a successful `TypeScript CI` run on the `typescript` branch
   - [x] publish stable `1.2.1` to npm
8. [ ] Start pre-stable parity implementation for deferred options
   - [x] implement `wordTimestamps`
   - [x] implement `clipTimestamps`
   - [x] implement `hallucinationSilenceThreshold`
   - [x] implement `hotwords`
   - [x] implement `languageDetectionThreshold`
   - [x] implement `languageDetectionSegments`
   - [x] run a two-model mini-matrix (`tiny` + `base`) before tagging `v1.2.1`
   - [ ] broaden the runtime/platform matrix after the stable tag

## Lot 0 - Commit Hygiene And Baseline

Plan:
- [x] Confirm the repository baseline and current `HEAD`
- [x] Confirm whether the migration work is already committed
- [x] Confirm the `../graphify` reference model for package structure
- [ ] Create a dedicated migration branch for the cut-over if needed
- [x] Create the continuity branches needed for release and detach
- [x] Commit the current `ts/` migration tree as a safety checkpoint before the root move
- [x] Decide whether `.codex` should be ignored or removed so the worktree can become clean

Checkpoint commits created:
- [x] `a0515f1` `chore: add cut-over plan and ignore local artifacts`
- [x] `1dc8ea6` `feat(ts): add native bridge and FFI core`
- [x] `bb7ef28` `feat(ts): add audio decoding pipeline`
- [x] `ef8f9b2` `feat(ts): add tokenizer vad and feature extraction`
- [x] `4fbd470` `feat(ts): add end-to-end transcription pipeline`

Pending commit chunks:
- [x] `feat: cut over to a root-level npm package` (`1be2964`)
- [x] `chore: remove Python-first repository surface` (`51f0adc`)
- [x] `docs: rewrite npm-only docs and CI` (`c38ac2d`)
- [x] `chore: refresh cut-over plan after root migration` (`5aea4a1`)
- [x] `chore: remove remaining migration leftovers` (`29c6562`)
- [x] `feat: stabilize transcription timestamp handling` (`54c1c72`)
- [x] `docs: add npm release and publishing guide` (`4c60b9c`)
- [x] `docs: expand README parity coverage` (`639b361`)
- [x] `docs: note fresh install network requirements` (`7757fdd`)
- [x] `chore: switch node audio decoding to system ffmpeg` (`4bfb62d`)
- [x] `ci: add pristine tarball install smoke test` (`511035c`)
- [x] `ci: trigger github actions` (`33ef220`)
- [x] `ci: install ffmpeg on github actions` (`3145eff`)

## Lot 1 - Phase 1 Recap: C/C++ Bridge (`whisper_bridge`)

Status: implemented and smoke-tested

Completed:
- [x] Create a native `whisper_bridge` project with CMake-based build
- [x] Expose native model lifecycle functions (`init`, `free`, `generate`)
- [x] Build a shared library consumed from Node.js
- [x] Reach a stable `model.generate` path after debugging deadlock/thread-pool issues
- [x] Produce a working `libwhisper_bridge.so` in the current development layout

Carry-over hardening:
- [x] Remove repo-local absolute library paths from the TypeScript loader
- [x] Make the native library location deterministic from a root-level package install
- [x] Decide the long-term install strategy:
  - [x] build-from-source on `npm install`
  - [x] prebuilt binaries are explicitly deferred until after the first npm-only release

## Lot 2 - Phase 2 Recap: TypeScript Core And FFI

Status: implemented and smoke-tested

Completed:
- [x] Create the TypeScript-side `WhisperModel` wrapper around the native bridge
- [x] Define the FFI structs and calls with `koffi`
- [x] Validate model load and free from Node.js
- [x] Keep the bridge callable from the current `ts/src/whisper.ts`

Carry-over hardening:
- [x] Add a root-level `src/index.ts` public entrypoint
- [x] Replace development-only test scripts with exported library APIs plus tests
- [x] Normalize package types, exports, and declarations from the future root package

## Lot 3 - Phase 3 Recap: Audio Pipeline (`audio.ts`)

Status: implemented with hybrid runtime strategy

Completed:
- [x] Port `decode_audio` and `pad_or_trim`
- [x] Implement the Node.js fast path with `ffmpeg`
- [x] Keep a browser-oriented fallback path with `@ffmpeg/ffmpeg`
- [x] Match the `jfk.flac` smoke-test output used during the migration

Carry-over hardening:
- [x] Decide the supported runtime matrix for the npm package
  - [x] Node.js native path (system `ffmpeg`) is the supported release target
  - [x] browser/WASM fallback is kept in code but not declared stable
- [x] Document the supported runtime matrix clearly in the future README
- [x] Turn the current audio smoke script into an automated test under the root package

## Lot 4 - Phase 4 Recap: Feature Extractor, VAD, Tokenizer

Status: implemented and smoke-tested

Completed:
- [x] Port the tokenizer behavior and special-token handling
- [x] Port Silero VAD execution with `onnxruntime-node`
- [x] Port the mel feature extractor path used by transcription
- [x] Validate the dedicated smoke scripts for tokenizer, feature extractor, and VAD

Carry-over hardening:
- [x] Package the VAD asset cleanly instead of resolving it through repo-relative assumptions
- [x] Remove hard-coded model and fixture paths from the smoke scripts
- [x] Convert the smoke scripts into a durable automated parity suite
- [ ] Verify broader model coverage beyond the single current migration path

## Lot 5 - Phase 5 Recap: End-to-End Transcription (`transcribe.ts`)

Status: implemented at smoke-test level

Completed:
- [x] Assemble the end-to-end TypeScript transcription loop
- [x] Restore correct multilingual prompt construction
- [x] Reach a successful transcription on `tests/data/jfk.flac`
- [x] Produce the expected JFK sentence with `vadFilter: true`

Carry-over hardening:
- [ ] Replace the current proof-by-smoke-test with an explicit parity matrix
- [x] Review simplified or POC-marked sections before calling the package stable
  - [x] replace the stubbed VAD timestamp remapping in `src/transcribe.ts`
  - [x] replace the simplified timestamp split logic in `src/transcribe.ts`
  - [x] replace the simplified seek advancement logic in `src/transcribe.ts`
- [x] Decide which features are fully supported at cut-over time versus explicitly deferred
  - [x] `wordTimestamps` moved from deferred to implemented
  - [x] `clipTimestamps` moved from deferred to implemented
  - [x] `hallucinationSilenceThreshold` moved from deferred to implemented
  - [x] `hotwords` moved from deferred to implemented
  - [x] `languageDetectionThreshold` / `languageDetectionSegments` moved from deferred to implemented
- [x] Replace deferred-option rejection with runtime parity coverage in code and tests

## Lot 6 - Root-Level npm Package Finalization

Goal: replace the Python-first repository layout with a **root-level npm-only package**, following the `../graphify` model (`package.json` at repo root, root `src/`, root `tests/`, root `dist/`, root-level build/test scripts, MIT license, clean package exports).

Plan:
- [x] Create the root package manifest modeled after `../graphify`
  - [x] move from `ts/package.json` to a real root `package.json`
  - [x] set the final package name
  - [x] set `type`, `main`, `module`, `types`, and `exports`
  - [x] add `files` so npm publishes only the intended runtime artifacts
  - [x] add `engines.node`
  - [x] align `license`, `repository`, `homepage`, and `bugs`
- [x] Move the TypeScript project to repo root
  - [x] move `ts/src` to root `src`
  - [x] move `ts/whisper_bridge` to a root native directory
  - [x] move `ts/tsconfig.json` to root `tsconfig.json`
  - [x] move or recreate root `tests` for the TypeScript package
  - [x] stop using `ts/` as a nested package boundary
- [x] Normalize the root build pipeline
  - [x] add root `build`, `dev`, `lint`, `test`, and `prepublishOnly` scripts
  - [x] integrate the native bridge build from the root package
  - [x] decide whether to use `tsc` only or `tsup`-style packaging at root
  - [x] make `npm pack` succeed from repo root
  - [x] add a pristine tarball install smoke test modeled after `../voxtral-ts`
- [x] Clean up runtime path resolution
  - [x] remove the hard-coded path to `libwhisper_bridge.so`
  - [x] remove hard-coded model snapshot paths from library code
  - [x] resolve VAD and tokenizer assets relative to the installed package layout
- [x] Convert the current development fixtures into proper tests
  - [x] keep the current smoke scripts as tests or examples, not as the user-facing API
  - [x] ensure root `npm test` covers at least the existing migration proof points
- [x] Remove Python from the repository once the npm root is live
  - [x] delete the tracked Python source files under `faster_whisper/`
  - [x] delete Python packaging files: `setup.py`, `setup.cfg`, `MANIFEST.in`, `requirements.txt`, `requirements.conversion.txt`
  - [x] delete or replace Python-specific tests under `tests/`
  - [x] remove the leftover local directories and binary remnants under `faster_whisper/`, `benchmark/`, and `docker/`
  - [x] decide the fate of `benchmark/`:
    - [x] remove it from the npm-only repository
  - [x] decide the fate of `docker/`:
    - [x] remove it from the npm-only repository
- [ ] Make the root repository clean and releasable
  - [x] remove the physical `ts/` directory from disk
  - [x] keep `graphify-out/` ignored as local output
  - [x] ensure `git status --short` is clean after the move and commits
  - [x] ensure the root repo can be cloned and built with npm only
    - Current result: `npm ci` and `npm run build` passed in `/tmp/faster-whisper-release-check`

## Lot 7 - README, Docs, License, And Attribution Cut-over

Goal: replace the current Python/PyPI-facing documentation with a Node/npm-facing documentation set while keeping the README coverage as close as possible to the current repository and clearly thanking the original project.

Plan:
- [x] Rewrite the root `README.md` for the npm-only package
  - [x] replace PyPI/pip badges and installation instructions with npm equivalents
  - [x] replace Python examples with TypeScript/JavaScript examples
  - [x] document the root-level npm install/build/test flow
  - [x] document the native bridge prerequisites honestly
- [x] Keep section-level parity with the current README where applicable
  - [x] intro and positioning
  - [x] benchmark/performance section
  - [x] requirements
  - [x] installation
  - [x] usage
  - [x] word timestamps
  - [x] VAD filter
  - [x] logging
  - [x] going further / integrations
  - [x] model conversion notes
  - [x] performance comparison notes
- [x] For every current README section, choose one explicit outcome
  - [x] supported and documented in the npm package
  - [x] supported but deferred in docs until validated
  - [x] intentionally removed from the npm-only port with explanation
- [x] Keep the project on the same free-license model
  - [x] stay on MIT unless a better-documented reason appears to change it
  - [ ] update the copyright/authorship lines appropriately for the port
  - [x] ensure the original license obligations remain satisfied
- [x] Thank the original project explicitly
  - [x] add a clear acknowledgment in `README.md`
  - [x] identify the project as a TypeScript port of `SYSTRAN/faster-whisper`
  - [x] thank the original maintainers for the implementation and direction
- [x] Update supporting docs after the README rewrite
  - [x] `CONTRIBUTING.md`
  - [x] release/build instructions
  - [x] package publishing notes

## Lot 8 - Fork Detach, Branch Topology, And Version Mapping

Goal: preserve the last Python state as a reference branch, promote the npm-only TypeScript port as the main line after fork detachment, and keep the first detached release version aligned with the upstream Python baseline.

Plan:
- [x] Confirm the current GitHub repository is still a fork of `SYSTRAN/faster-whisper`
- [ ] Detach the GitHub fork relationship
  - [x] use the GitHub-supported detach flow if available
  - [x] otherwise delete and recreate the repository while preserving branches/tags
- [x] Preserve the Python baseline as a continuity branch
  - [x] create `python-origin`
  - [x] pin it to `ed9a06c`
  - [x] record that this branch corresponds to upstream Python `1.2.1`
- [x] Preserve the TypeScript release line as a dedicated branch
  - [x] create `typescript`
  - [x] point it at the current npm-only release candidate
- [ ] Promote the TypeScript line after detach
  - [x] switch the default branch to `typescript`
  - [ ] keep `master` only as a temporary transition branch or remove it after the switch
- [x] Define the version mapping explicitly
  - [x] `python-origin` => frozen Python-compatible baseline `1.2.1`
  - [x] `typescript` => detached npm-only line at `1.2.1` after parity is reached
  - [x] stable `v1.2.1` => scoped parity with the Python `1.2.1` baseline on Node.js/Linux CPU
  - [x] do not publish a stable detached `1.2.x` version before parity
- [ ] Re-run release validation on the detached line
  - [x] expand GitHub Actions triggers to include `typescript`
  - [x] push `typescript`
  - [x] verify GitHub Actions on the detached repository
  - [x] add `workflow_dispatch` as an explicit CI recovery path on the detached repo
  - [x] defer `v1.2.1` tag until parity
  - [x] tag stable `v1.2.1`
  - [x] add a post-CI npm publish workflow for merges into `typescript`
  - [x] publish stable `1.2.1` to npm

## Lot 10 - Post-Merge npm Publishing

Goal: publish the npm package automatically after the default TypeScript branch receives a merge and the release-shaped CI passes.

Plan:
- [x] Add `.github/workflows/npm-publish.yml`
- [x] Trigger publish only after `TypeScript CI` completes successfully
- [x] Restrict automatic publishing to push CI runs on the `typescript` branch
- [x] Keep `workflow_dispatch` as an explicit recovery path on `typescript`
- [x] Make publishing idempotent by skipping if `package.json`'s npm version already exists
- [x] Publish through npm Trusted Publishing / GitHub OIDC, without `NPM_TOKEN`
- [x] Keep npm provenance enabled through Trusted Publishing
- [x] Force the publish step to ignore any inherited `NODE_AUTH_TOKEN` and use a token-free npm config
- [x] Ensure the matching `v<package.version>` tag exists after a new publish
- [ ] Configure npmjs.com Trusted Publisher for package `faster-whisper-ts`
  - npm package: `faster-whisper-ts`
  - publisher: GitHub Actions
  - organization/user: `rhanka`
  - repository: `faster-whisper`
  - workflow filename: `npm-publish.yml`
  - environment: leave empty unless a GitHub deployment environment is added
  - current blocker: npm requires a fresh 2FA/OTP confirmation; CLI web polling did not complete after two validated URLs
- [x] Verify repository-side OIDC on automatic publish run `24587992393`
- [x] Verify first npm publish for `faster-whisper-ts@1.2.1`
  - current result: one-time bootstrap publish succeeded locally as npm user `rhk`
  - current result: `npm view faster-whisper-ts@1.2.1 version --json` returns `"1.2.1"`

Branch-protection note:
- [ ] Require `TypeScript CI` on pull requests into `typescript` in GitHub branch protection/rulesets so merges cannot bypass the same gate that precedes publishing.

## Lot 9 - Pre-Stable Parity Implementation

Goal: do not publish or tag stable `v1.2.1` until the currently deferred transcription options and parity gaps are closed.

Current release posture:

- [x] keep the npm package on `0.1.0` while parity is incomplete
- [x] bump the npm package to `1.2.1` after parity with upstream Python `1.2.1` is validated on the supported target
- [x] keep the supported target scoped to the currently validated Node.js/Linux CPU path
- [x] treat unsupported transcription options as explicit follow-up work, not hidden parity claims

Pre-stable implementation and validation plan:

- [x] implement stable `wordTimestamps` support
  - [x] align timestamp token handling and segment/word boundaries with upstream behavior
  - [x] add regression tests beyond the original JFK smoke
- [x] implement `clipTimestamps`
  - [x] match seek/window semantics with upstream behavior
  - [x] add API and regression coverage
- [x] implement `hallucinationSilenceThreshold`
  - [x] port the threshold behavior from the Python logic
  - [x] cover the option together with word timestamps
- [x] implement `hotwords`
  - [x] define the prompt wiring and tokenizer behavior in TypeScript
  - [x] add targeted prompt-conditioning tests
- [x] implement `languageDetectionThreshold` and `languageDetectionSegments`
  - [x] port the language-detection loop and thresholds
  - [x] add validation coverage on the tiny multilingual test model
- [ ] broaden validation after each feature lot
  - [x] add an executable parity matrix to CI (`npm run test:parity-matrix`)
  - [x] cover multiple fixtures and option combinations: JFK, hotwords, multilingual, long-form physics, clip timestamps, word timestamps, hallucination threshold, language detection thresholds
  - [x] run the parity matrix on at least one additional CTranslate2 model beyond `tiny` before tagging stable `v1.2.1`
  - [x] validated locally on `Systran/faster-whisper-tiny@d90ca5fe260221311c53c58e660288d3deb8d356`
  - [x] validated locally on `Systran/faster-whisper-base@ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`
  - [ ] broader runtime/platform matrix where realistic
  - [x] keep the matrix explicit in `PLAN.md` instead of relying on smoke-only evidence

## Exit Criteria

- [x] The current TypeScript migration work is committed
- [x] The repository root is npm-only and historical leftovers are removed
- [x] The nested `ts/` package no longer exists on disk
- [x] Python package and Python packaging files are removed from the repository
- [x] Root `npm install`, `npm run build`, `npm test`, and `npm pack` succeed
- [x] GitHub Actions passes on the migrated repository
- [x] Runtime code no longer depends on repo-local absolute paths
- [x] The root `README.md` documents the npm package, not the old Python package
- [x] The project remains under a permissive free license
- [x] The original `SYSTRAN/faster-whisper` project is explicitly acknowledged
- [x] `python-origin` preserves the last Python baseline
- [x] `typescript` becomes the default branch after fork detach
- [x] Parity is implemented and the mini-matrix passes before any stable `v1.2.1` tag
- [x] Stable `v1.2.1` is tagged
- [x] Stable `1.2.1` is published to npm
- [x] Deferred transcription options are implemented or remain explicitly documented as limitations
- [x] `git status --short` is clean at the end of the cut-over
