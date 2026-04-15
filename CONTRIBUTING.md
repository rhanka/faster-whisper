# Contributing

This repository is now maintained as a root-level npm package.

## Local setup

```bash
git clone https://github.com/rhanka/faster-whisper.git
cd faster-whisper
npm ci
```

## Validate changes

```bash
npm run build
npm run lint
npm test
npm run pack:check
```

If you already have a converted CTranslate2 Whisper model locally, you can point the smoke suite to it:

```bash
FASTER_WHISPER_TEST_MODEL=/absolute/path/to/model npm test
```

Otherwise `npm test` will try to use the repo-local `test-models/faster-whisper-tiny` cache or bootstrap it automatically.

## Scope

Contributions should preserve the npm-only repository layout:

- root `package.json`
- root `src/`
- root `tests/`
- root `whisper_bridge/`
- no new Python packaging surface

For release and npm publishing steps, use [RELEASING.md](RELEASING.md).
