# Releasing

This repository is published as a root-level npm package.

## Preconditions

- Node.js 20+
- `npm`
- `cmake`
- a C++17 compiler toolchain
- npm publish rights for `faster-whisper-ts`

The current release target is the Linux CPU path that builds `whisper_bridge` from source during install.

## Release Checklist

1. Work from a clean branch tip.
2. Update `package.json` version.
3. Validate the package from the repository root:

```bash
npm ci
npm run build
npm run lint
npm test
npm run pack:check
```

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

## Publish Notes

- The published package is intentionally limited by the `files` whitelist in `package.json`.
- The release currently vendors the native bridge sources, CTranslate2 headers, and Linux CPU shared-library inputs needed by `postinstall`.
- Deferred features such as word timestamps, clip timestamp selection, and language-detection thresholds are documented in `README.md` and should not be advertised as stable until validated.
- If the package surface changes, update `README.md`, `CONTRIBUTING.md`, and `PLAN.md` in the same commit series.
