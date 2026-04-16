# faster-whisper-ts

TypeScript port of [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) for Node.js. This repository keeps the native CTranslate2 bridge, audio decoding, mel feature extraction, tokenizer handling, Silero VAD, and end-to-end Whisper transcription in a root-level npm package.

Thanks to the original `faster-whisper` project for the implementation direction, API model, and baseline behavior this port is built from.

## Status

- Root package is now npm-only.
- Native bridge build works from repo root.
- Current smoke coverage passes on:
  - bridge load/free
  - audio decoding
  - tokenizer behavior
  - feature extraction
  - VAD
  - end-to-end transcription on `tests/data/jfk.flac`
- Transcription timestamp splitting and VAD timestamp restoration now follow the upstream logic instead of the earlier POC shortcuts.
- Deferred transcription options now fail fast with explicit errors instead of being silently ignored.
- Some parity work is still pending before claiming full upstream coverage:
  - full benchmark matrix
  - broader model/runtime validation

## Requirements

- Node.js 20+
- `npm`
- `cmake`
- a C++17 compiler toolchain
- `ffmpeg` available on `PATH` for Node.js audio decoding, or `FASTER_WHISPER_FFMPEG_PATH` set explicitly

The package builds `whisper_bridge` locally during install. The repository vendors the CTranslate2 headers and shared libraries needed by the current Linux CPU path.

A fresh `npm install` still needs network access for `onnxruntime-node`. The Node.js decoder no longer depends on `ffmpeg-static`; it uses the system `ffmpeg` binary instead.

## Runtime Support

- Supported release target: Node.js 20+ on the current Linux CPU path with system `ffmpeg`
- Kept in code but not yet declared as a stable package target: the browser-oriented FFmpeg WASM fallback in `audio.ts`
- Not yet packaged as a stable release target: GPU runtime variants and prebuilt native binaries
- First npm release decision: install from source at `postinstall`; prebuilt binaries are explicitly deferred

## Installation

Current package name:

```bash
npm install faster-whisper-ts
```

From this repository before publication:

```bash
git clone https://github.com/rhanka/faster-whisper.git
cd faster-whisper
npm ci
npm run build
```

## Usage

```ts
import { WhisperModel } from "faster-whisper-ts";

const model = new WhisperModel("/absolute/path/to/ctranslate2-model", "cpu", 0, "default");

const [segments, info] = await model.transcribe("tests/data/jfk.flac", {
  beamSize: 5,
  vadFilter: true,
});

console.log(info);
for (const segment of segments) {
  console.log(`[${segment.start.toFixed(2)} -> ${segment.end.toFixed(2)}] ${segment.text}`);
}

model.free();
```

The exported surface currently includes:

- `WhisperModel`
- `Tokenizer`
- `FeatureExtractor`
- `SileroVADModel`
- `getSpeechTimestamps`
- `decodeAudio`
- `padOrTrim`

## Current Option Status

The current cut-over intentionally documents a narrower stable surface than upstream `faster-whisper`.

Validated in the current smoke path:

- base transcription from a local audio file
- `beamSize`
- `vadFilter`
- root-level native bridge loading and teardown

Currently deferred until the TypeScript port is stabilized further:

- stable word-timestamp parity
- `clipTimestamps`
- `hallucinationSilenceThreshold`
- `hotwords`
- `languageDetectionThreshold`
- `languageDetectionSegments`
- broader multilingual/runtime validation beyond the current smoke path

When one of these deferred options is passed today, the TypeScript port throws an explicit error instead of silently accepting unsupported behavior.

## Word Timestamps

Word-level timestamp extraction is not yet part of the stable npm surface. Passing `wordTimestamps: true` currently throws an explicit error until the TypeScript port has parity-grade timestamp alignment and validation.

## VAD

Silero VAD is packaged at `assets/silero_vad_v6.onnx` and resolved relative to the installed package layout. Enable it during transcription with:

```ts
const [segments] = await model.transcribe("audio.mp3", {
  vadFilter: true,
});
```

If `ffmpeg` is not on `PATH`, set:

```bash
FASTER_WHISPER_FFMPEG_PATH=/absolute/path/to/ffmpeg
```

## Tests

Run the full local validation flow from the repository root:

```bash
npm test
npm run test:pristine-install
```

`npm test` will:

1. build the native bridge and TypeScript output,
2. ensure the tiny test model is available in `test-models/faster-whisper-tiny` or via `FASTER_WHISPER_TEST_MODEL`,
3. run the current smoke suite.

If you already have a converted CTranslate2 model elsewhere, point tests to it:

```bash
FASTER_WHISPER_TEST_MODEL=/absolute/path/to/model npm test
```

`npm run test:pristine-install` adds the release-style smoke check: it packs the library, creates an empty temp project, runs `npm install <tarball>`, then verifies the installed runtime dependencies, native build output, and root exports from that clean install.

## Benchmark And Performance

The npm-only port does not currently ship the old Python benchmark harness. Performance claims from the original repository are therefore not restated here until the Node.js port has its own reproducible benchmark matrix.

The current priority is correctness of the root package, deterministic native builds, and a documented install path for the Linux CPU target.

## Logging

The current package does not yet expose a structured logging API equivalent to the original Python surface. In practice:

- native bridge and CTranslate2 messages may still appear on stderr/stdout,
- smoke tests rely on process output today,
- package-level logging controls remain to be designed if a stable public logger is introduced later.

## Packaging

Useful root-level commands:

```bash
npm run build
npm run lint
npm test
npm run test:pristine-install
npm run pack:check
```

`npm run pack:check` verifies the publishable tarball from the repo root. The published package is intended to contain only the compiled JS, assets, build scripts, vendored native inputs, and license/readme files required at install time.

Release and publish steps are documented in [RELEASING.md](RELEASING.md).

## Going Further

- Use a local converted CTranslate2 Whisper model directory and pass its absolute path to `new WhisperModel(...)`.
- Integrate the package from Node.js first; the browser-oriented fallback path is intentionally not documented as stable yet.
- Keep release expectations scoped to the current Linux CPU path until GPU and prebuilt distribution are validated separately.

## Model Conversion

Model conversion tooling is intentionally not bundled in this npm-only repository. For now, prepare converted Whisper models outside this package using the original `faster-whisper` / CTranslate2 workflow, then point the Node.js API at the resulting model directory.

The expected runtime inputs remain the converted model weights plus tokenizer/config files such as `tokenizer.json`.

## Performance Comparison Notes

This repository does not currently claim benchmark parity with upstream `faster-whisper`. The first npm release is positioned as a TypeScript/Node packaging and runtime port, not as a reproduced performance study.

## Removed From The npm Port

The following repository surfaces from the original Python-first layout were intentionally removed from this npm-only port:

- Python packaging and import surface
- Python-oriented benchmark harness
- Docker assets tied to the previous Python workflow

These removals are intentional and part of the root-level npm cut-over, not accidental omissions.

## Notes On Parity

This repository is not claiming complete feature parity with upstream `faster-whisper` yet. The current port is centered on the existing TypeScript implementation that already validates the main inference path. Items still intentionally deferred or not yet fully documented include:

- benchmark reproduction in Node beyond the current smoke coverage
- broader model/runtime validation beyond the tiny-model Linux CPU path
- stable word-timestamp parity

## License

This repository remains under the MIT license model. See [LICENSE](LICENSE).
