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
  - documentation parity across every upstream section
  - broader model/runtime validation

## Requirements

- Node.js 20+
- `npm`
- `cmake`
- a C++17 compiler toolchain

The package builds `whisper_bridge` locally during install. The repository vendors the CTranslate2 headers and shared libraries needed by the current Linux CPU path.

## Runtime Support

- Supported release target: Node.js 20+ on the current Linux CPU path
- Kept in code but not yet declared as a stable package target: the browser-oriented FFmpeg WASM fallback in `audio.ts`
- Not yet packaged as a stable release target: GPU runtime variants and prebuilt native binaries

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

## VAD

Silero VAD is packaged at `assets/silero_vad_v6.onnx` and resolved relative to the installed package layout. Enable it during transcription with:

```ts
const [segments] = await model.transcribe("audio.mp3", {
  vadFilter: true,
});
```

## Tests

Run the full local validation flow from the repository root:

```bash
npm test
```

`npm test` will:

1. build the native bridge and TypeScript output,
2. ensure the tiny test model is available in `test-models/faster-whisper-tiny` or via `FASTER_WHISPER_TEST_MODEL`,
3. run the current smoke suite.

If you already have a converted CTranslate2 model elsewhere, point tests to it:

```bash
FASTER_WHISPER_TEST_MODEL=/absolute/path/to/model npm test
```

## Packaging

Useful root-level commands:

```bash
npm run build
npm run lint
npm test
npm run pack:check
```

`npm run pack:check` verifies the publishable tarball from the repo root. The published package is intended to contain only the compiled JS, assets, build scripts, vendored native inputs, and license/readme files required at install time.

## Notes On Parity

This repository is not claiming complete feature parity with upstream `faster-whisper` yet. The current port is centered on the existing TypeScript implementation that already validates the main inference path. Items still intentionally deferred or not yet fully documented include:

- benchmark reproduction in Node
- Python-specific workflows from the original repository
- model conversion tooling
- full documentation for every upstream transcription option
- stable word-timestamp parity

## License

This repository remains under the MIT license model. See [LICENSE](LICENSE).
