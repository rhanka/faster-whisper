# TypeScript Cut-over Plan

## Snapshot

- [x] Confirm current upstream baseline branch: `master`
- [x] Confirm current upstream baseline commit: `ed9a06c` (`origin/master`)
- [x] Confirm current migration workspace: `ts/`
- [x] Inspect `../graphify` as the reference model for a root-level npm-only package
- [x] Verify current validation evidence for the TypeScript migration:
  - [x] `bash -lc './node_modules/.bin/tsc -p tsconfig.json --noEmit'` from `ts/`
  - [x] `node dist/test_audio.js`
  - [x] `node dist/test_tokenizer.js`
  - [x] `node dist/test_feature_extractor.js`
  - [x] `node dist/test_vad.js`
  - [x] `node dist/test_transcribe.js`
- [x] Verify whether everything has been committed
- [x] Working tree is fully committed
  - Current result: `git status --short --branch` is clean, with local commits ahead of `origin/master`
  - Current result: `.codex` is ignored
  - Current result: the TypeScript migration work is now committed in logical chunks

## Guardrails

- [x] Keep this file as the execution source of truth for the repo cut-over
- [x] Keep the migration target as a **root-level npm-only package**, modeled after `../graphify`
- [x] Keep the repository on a permissive free-software license model
- [x] Plan to preserve and acknowledge the original `SYSTRAN/faster-whisper` work explicitly
- [x] Treat phases 1 to 5 as already implemented at smoke-test level, not yet fully industrialized
- [x] Do not claim full parity in documentation until the automated parity matrix exists
- [x] Create a first explicit checkpoint commit for the current TypeScript migration before destructive moves
- [ ] Do not delete Python files until the root-level npm package builds and tests successfully from repo root
- [ ] Eliminate all hard-coded absolute local paths before calling the package releasable

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

## Lot 1 - Phase 1 Recap: C/C++ Bridge (`whisper_bridge`)

Status: implemented and smoke-tested

Completed:
- [x] Create a native `whisper_bridge` project with CMake-based build
- [x] Expose native model lifecycle functions (`init`, `free`, `generate`)
- [x] Build a shared library consumed from Node.js
- [x] Reach a stable `model.generate` path after debugging deadlock/thread-pool issues
- [x] Produce a working `libwhisper_bridge.so` in the current development layout

Carry-over hardening:
- [ ] Remove repo-local absolute library paths from the TypeScript loader
- [ ] Make the native library location deterministic from a root-level package install
- [ ] Decide the long-term install strategy:
  - [ ] build-from-source on `npm install`
  - [ ] optional prebuilt binaries later

## Lot 2 - Phase 2 Recap: TypeScript Core And FFI

Status: implemented and smoke-tested

Completed:
- [x] Create the TypeScript-side `WhisperModel` wrapper around the native bridge
- [x] Define the FFI structs and calls with `koffi`
- [x] Validate model load and free from Node.js
- [x] Keep the bridge callable from the current `ts/src/whisper.ts`

Carry-over hardening:
- [ ] Add a root-level `src/index.ts` public entrypoint
- [ ] Replace development-only test scripts with exported library APIs plus tests
- [ ] Normalize package types, exports, and declarations from the future root package

## Lot 3 - Phase 3 Recap: Audio Pipeline (`audio.ts`)

Status: implemented with hybrid runtime strategy

Completed:
- [x] Port `decode_audio` and `pad_or_trim`
- [x] Implement the Node.js fast path with `ffmpeg-static`
- [x] Keep a browser-oriented fallback path with `@ffmpeg/ffmpeg`
- [x] Match the `jfk.flac` smoke-test output used during the migration

Carry-over hardening:
- [ ] Decide whether the npm package officially supports both:
  - [ ] Node.js native path (`ffmpeg-static`)
  - [ ] browser/WASM fallback
- [ ] Document the supported runtime matrix clearly in the future README
- [ ] Turn the current audio smoke script into an automated test under the root package

## Lot 4 - Phase 4 Recap: Feature Extractor, VAD, Tokenizer

Status: implemented and smoke-tested

Completed:
- [x] Port the tokenizer behavior and special-token handling
- [x] Port Silero VAD execution with `onnxruntime-node`
- [x] Port the mel feature extractor path used by transcription
- [x] Validate the dedicated smoke scripts for tokenizer, feature extractor, and VAD

Carry-over hardening:
- [ ] Package the VAD asset cleanly instead of resolving it through repo-relative assumptions
- [ ] Remove hard-coded model and fixture paths from the smoke scripts
- [ ] Convert the smoke scripts into a durable automated parity suite
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
- [ ] Review simplified or POC-marked sections before calling the package stable
- [ ] Decide which features are fully supported at cut-over time versus explicitly deferred

## Lot 6 - Root-Level npm Package Finalization

Goal: replace the Python-first repository layout with a **root-level npm-only package**, following the `../graphify` model (`package.json` at repo root, root `src/`, root `tests/`, root `dist/`, root-level build/test scripts, MIT license, clean package exports).

Plan:
- [ ] Create the root package manifest modeled after `../graphify`
  - [ ] move from `ts/package.json` to a real root `package.json`
  - [ ] set the final package name
  - [ ] set `type`, `main`, `module`, `types`, and `exports`
  - [ ] add `files` so npm publishes only the intended runtime artifacts
  - [ ] add `engines.node`
  - [ ] align `license`, `repository`, `homepage`, and `bugs`
- [ ] Move the TypeScript project to repo root
  - [ ] move `ts/src` to root `src`
  - [ ] move `ts/whisper_bridge` to a root native directory
  - [ ] move `ts/tsconfig.json` to root `tsconfig.json`
  - [ ] move or recreate root `tests` for the TypeScript package
  - [ ] stop using `ts/` as a nested package boundary
- [ ] Normalize the root build pipeline
  - [ ] add root `build`, `dev`, `lint`, `test`, and `prepublishOnly` scripts
  - [ ] integrate the native bridge build from the root package
  - [ ] decide whether to use `tsc` only or `tsup`-style packaging at root
  - [ ] make `npm pack` succeed from repo root
- [ ] Clean up runtime path resolution
  - [ ] remove the hard-coded path to `libwhisper_bridge.so`
  - [ ] remove hard-coded model snapshot paths from library code
  - [ ] resolve VAD and tokenizer assets relative to the installed package layout
- [ ] Convert the current development fixtures into proper tests
  - [ ] keep the current smoke scripts as tests or examples, not as the user-facing API
  - [ ] ensure root `npm test` covers at least the existing migration proof points
- [ ] Remove Python from the repository once the npm root is live
  - [ ] delete the Python package tree `faster_whisper/`
  - [ ] delete Python packaging files: `setup.py`, `setup.cfg`, `MANIFEST.in`, `requirements.txt`, `requirements.conversion.txt`
  - [ ] delete or replace Python-specific tests under `tests/`
  - [ ] decide the fate of `benchmark/`:
    - [ ] port relevant benchmarks to Node.js
    - [ ] or remove them from the npm-only repository
  - [ ] decide the fate of `docker/`:
    - [ ] port to a Node/npm image
    - [ ] or remove it from the npm-only repository
- [ ] Make the root repository clean and releasable
  - [ ] ensure `git status --short` is clean after the move
  - [ ] ensure there is no remaining nested `ts/` package
  - [ ] ensure the root repo can be cloned and built with npm only

## Lot 7 - README, Docs, License, And Attribution Cut-over

Goal: replace the current Python/PyPI-facing documentation with a Node/npm-facing documentation set while keeping the README coverage as close as possible to the current repository and clearly thanking the original project.

Plan:
- [ ] Rewrite the root `README.md` for the npm-only package
  - [ ] replace PyPI/pip badges and installation instructions with npm equivalents
  - [ ] replace Python examples with TypeScript/JavaScript examples
  - [ ] document the root-level npm install/build/test flow
  - [ ] document the native bridge prerequisites honestly
- [ ] Keep section-level parity with the current README where applicable
  - [ ] intro and positioning
  - [ ] benchmark/performance section
  - [ ] requirements
  - [ ] installation
  - [ ] usage
  - [ ] word timestamps
  - [ ] VAD filter
  - [ ] logging
  - [ ] going further / integrations
  - [ ] model conversion notes
  - [ ] performance comparison notes
- [ ] For every current README section, choose one explicit outcome
  - [ ] supported and documented in the npm package
  - [ ] supported but deferred in docs until validated
  - [ ] intentionally removed from the npm-only port with explanation
- [ ] Keep the project on the same free-license model
  - [ ] stay on MIT unless a better-documented reason appears to change it
  - [ ] update the copyright/authorship lines appropriately for the port
  - [ ] ensure the original license obligations remain satisfied
- [ ] Thank the original project explicitly
  - [ ] add a clear acknowledgment in `README.md`
  - [ ] identify the project as a TypeScript port of `SYSTRAN/faster-whisper`
  - [ ] thank the original maintainers for the implementation and direction
- [ ] Update supporting docs after the README rewrite
  - [ ] `CONTRIBUTING.md`
  - [ ] release/build instructions
  - [ ] package publishing notes

## Exit Criteria

- [x] The current TypeScript migration work is committed
- [ ] The repository root is npm-only
- [ ] The nested `ts/` package no longer exists
- [ ] Python package and Python packaging files are removed from the repository
- [ ] Root `npm install`, `npm run build`, `npm test`, and `npm pack` succeed
- [ ] Runtime code no longer depends on repo-local absolute paths
- [ ] The root `README.md` documents the npm package, not the old Python package
- [ ] The project remains under a permissive free license
- [ ] The original `SYSTRAN/faster-whisper` project is explicitly acknowledged
- [ ] `git status --short` is clean at the end of the cut-over
