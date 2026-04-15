# TypeScript Cut-over Plan

## Snapshot

- [x] Confirm current upstream baseline branch: `master`
- [x] Confirm current upstream baseline commit: `ed9a06c` (`origin/master`)
- [x] Confirm the historical migration workspace: `ts/`
- [x] Inspect `../graphify` as the reference model for a root-level npm-only package
- [x] Verify current validation evidence for the root-level npm package:
  - [x] `npm run build`
  - [x] `npm test`
  - [x] `NPM_CONFIG_CACHE=/tmp/faster-whisper-npm-cache npm run pack:check`
- [x] Verify whether everything has been committed
- [x] Working tree is fully committed
  - Current result: `git status --short --branch` is clean after the final leftover-cleanup commit
  - Current result: the branch now contains the full ordered cut-over history
- [x] `.codex` is ignored
- [x] Local migration leftovers are removed from disk
  - Current result: `ts/`, `faster_whisper/`, `benchmark/`, and `docker/` were removed locally after the root cut-over
  - Current result: `graphify-out/` is intentionally kept as a local ignored output directory

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

## Remaining Order

1. [x] Remove local leftovers that still make the repo look hybrid
   - [x] ignore `graphify-out/`
   - [x] keep the physical `graphify-out/` directory ignored as local output
   - [x] remove the physical `ts/` directory now that root files are in place
   - [x] remove the leftover legacy directories and binary remnants under `faster_whisper/`, `benchmark/`, and `docker/`
2. [ ] Finish the release-surface decisions for the npm-only repo
   - [x] remove the Python-only `benchmark/` surface from the npm-only repository
   - [x] remove the Python-only `docker/` surface from the npm-only repository
   - [ ] decide whether prebuilt native binaries are deferred or planned
3. [ ] Stabilize the transcription layer beyond the current smoke proof
   - [x] review and replace the remaining simplified/POC logic in `src/transcribe.ts`
   - [x] align the code and tests with the newly documented supported/deferred option surface
   - [ ] broaden model coverage beyond the single tiny-model smoke path
4. [ ] Finish documentation parity for the npm-only port
   - [ ] expand the README section coverage
   - [x] add release and publishing notes
5. [ ] Commit the cut-over in ordered chunks and end on a clean `git status`

## Lot 0 - Commit Hygiene And Baseline

Plan:
- [x] Confirm the repository baseline and current `HEAD`
- [x] Confirm whether the migration work is already committed
- [x] Confirm the `../graphify` reference model for package structure
- [ ] Create a dedicated migration branch for the cut-over if needed
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
- [ ] Decide the long-term install strategy:
  - [x] build-from-source on `npm install`
  - [ ] optional prebuilt binaries later

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
- [x] Implement the Node.js fast path with `ffmpeg-static`
- [x] Keep a browser-oriented fallback path with `@ffmpeg/ffmpeg`
- [x] Match the `jfk.flac` smoke-test output used during the migration

Carry-over hardening:
- [x] Decide the supported runtime matrix for the npm package
  - [x] Node.js native path (`ffmpeg-static`) is the supported release target
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
  - [x] `wordTimestamps` is explicitly deferred
  - [x] `clipTimestamps` is explicitly deferred
  - [x] `hallucinationSilenceThreshold` is explicitly deferred
  - [x] `hotwords` is explicitly deferred
  - [x] `languageDetectionThreshold` / `languageDetectionSegments` are explicitly deferred
- [x] Reject deferred transcription options explicitly in code and tests

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
  - [ ] ensure the root repo can be cloned and built with npm only

## Lot 7 - README, Docs, License, And Attribution Cut-over

Goal: replace the current Python/PyPI-facing documentation with a Node/npm-facing documentation set while keeping the README coverage as close as possible to the current repository and clearly thanking the original project.

Plan:
- [x] Rewrite the root `README.md` for the npm-only package
  - [x] replace PyPI/pip badges and installation instructions with npm equivalents
  - [x] replace Python examples with TypeScript/JavaScript examples
  - [x] document the root-level npm install/build/test flow
  - [x] document the native bridge prerequisites honestly
- [ ] Keep section-level parity with the current README where applicable
  - [x] intro and positioning
  - [ ] benchmark/performance section
  - [x] requirements
  - [x] installation
  - [x] usage
  - [ ] word timestamps
  - [x] VAD filter
  - [ ] logging
  - [ ] going further / integrations
  - [ ] model conversion notes
  - [ ] performance comparison notes
- [ ] For every current README section, choose one explicit outcome
  - [x] supported and documented in the npm package
  - [x] supported but deferred in docs until validated
  - [ ] intentionally removed from the npm-only port with explanation
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

## Exit Criteria

- [x] The current TypeScript migration work is committed
- [x] The repository root is npm-only and historical leftovers are removed
- [x] The nested `ts/` package no longer exists on disk
- [x] Python package and Python packaging files are removed from the repository
- [x] Root `npm install`, `npm run build`, `npm test`, and `npm pack` succeed
- [x] Runtime code no longer depends on repo-local absolute paths
- [x] The root `README.md` documents the npm package, not the old Python package
- [x] The project remains under a permissive free license
- [x] The original `SYSTRAN/faster-whisper` project is explicitly acknowledged
- [x] `git status --short` is clean at the end of the cut-over
