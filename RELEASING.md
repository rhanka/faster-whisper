# Releasing

This repository is prepared as a root-level npm package.

## Preconditions

- Node.js 20+
- `npm`
- `cmake`
- a C++17 compiler toolchain
- npm publish rights for `faster-whisper-ts`
- `ffmpeg` available on `PATH` for Node.js decoding, or `FASTER_WHISPER_FFMPEG_PATH` set explicitly

The current release target is the Linux CPU path that builds `whisper_bridge` from source during install.

Fresh installs still require network access for `onnxruntime-node`. Audio decoding in Node.js now relies on the system `ffmpeg` binary instead of `ffmpeg-static`.

## Release Checklist

1. Work from a clean branch tip.
2. Update `package.json` version.
   Stable `1.2.1` is used only after the TypeScript port reaches parity with upstream Python `faster-whisper` `1.2.1` on the supported Node.js/Linux CPU target.
   The required pre-stable parity gate is `npm test`, `npm run test:pristine-install`, and `npm run test:parity-matrix` on at least the `tiny` + `base` CTranslate2 models.
3. Validate the package from the repository root:

```bash
npm ci
npm run build
npm run lint
npm test
FASTER_WHISPER_PARITY_MODELS="tiny=/path/to/tiny,base=/path/to/base" npm run test:parity-matrix
npm run test:pristine-install
npm run pack:check
```

`npm run test:pristine-install` is the tarball smoke test: it installs the packed library into an empty temp project and verifies the installed package surface there.

4. Inspect the tarball contents if needed:

```bash
npm pack
tar -tf faster-whisper-ts-*.tgz
rm faster-whisper-ts-*.tgz
```

5. Publish from the repository root only after deciding the release track:

For a non-parity preview, keep a `0.x` version and publish under a non-default dist tag:

```bash
npm publish --tag next
```

For the stable parity release, first complete the parity work in `PLAN.md`, then publish:

```bash
npm publish
```

6. Tag the stable parity release from the `typescript` branch only after parity is implemented and validated:

```bash
git tag v1.2.1
git push origin v1.2.1
```

## Publish Notes

- The published package is intentionally limited by the `files` whitelist in `package.json`.
- The release currently vendors the native bridge sources, CTranslate2 headers, and Linux CPU shared-library inputs needed by `postinstall`.
- Word timestamps, clip timestamp selection, hotwords, hallucination silence skipping, and language-detection thresholds are part of the stable scoped Node.js/Linux CPU surface once the parity matrix has passed.
- If the package surface changes, update `README.md`, `CONTRIBUTING.md`, and `PLAN.md` in the same commit series.
