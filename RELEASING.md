# Releasing

This repository is published as a root-level npm package.

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
   The first detached TypeScript release should stay aligned with the upstream Python baseline at `1.2.1`.
3. Validate the package from the repository root:

```bash
npm ci
npm run build
npm run lint
npm test
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

5. Publish from the repository root:

```bash
npm publish
```

6. Tag the detached TypeScript release from the `typescript` branch:

```bash
git tag v1.2.1
git push origin v1.2.1
```

## Publish Notes

- The published package is intentionally limited by the `files` whitelist in `package.json`.
- The release currently vendors the native bridge sources, CTranslate2 headers, and Linux CPU shared-library inputs needed by `postinstall`.
- Deferred features such as word timestamps, clip timestamp selection, and language-detection thresholds are documented in `README.md` and should not be advertised as stable until validated.
- If the package surface changes, update `README.md`, `CONTRIBUTING.md`, and `PLAN.md` in the same commit series.
