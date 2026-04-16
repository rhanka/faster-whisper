#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TMP_DIR="$(mktemp -d)"
NPM_CACHE_DIR="$TMP_DIR/npm-cache"
TARBALL=""
INSTALL_DIR="$TMP_DIR/install"

cleanup() {
  rm -rf "$TMP_DIR"
  if [ -n "$TARBALL" ]; then
    rm -f "$PROJECT_DIR/$TARBALL"
  fi
}
trap cleanup EXIT

echo "═══════════════════════════════════════════════════"
echo "  faster-whisper-ts pristine tarball smoke test"
echo "═══════════════════════════════════════════════════"
echo ""

echo "Step 1: Build..."
cd "$PROJECT_DIR"
export npm_config_cache="$NPM_CACHE_DIR"
npm run build
echo "  ✓ Build succeeded"

echo "Step 2: Pack..."
TARBALL="$(npm pack 2>/dev/null | tail -1)"
echo "  ✓ Packed: $TARBALL"

echo "Step 3: Install tarball in a pristine temp project..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
npm init -y --silent >/dev/null
npm install "$PROJECT_DIR/$TARBALL"
echo "  ✓ Installed tarball and resolved dependencies"

PKG_DIR="$INSTALL_DIR/node_modules/faster-whisper-ts"

echo "Step 4: Verify packaged files..."
[ -f "$PKG_DIR/dist/src/index.js" ] || { echo "  ✗ dist/src/index.js missing"; exit 1; }
[ -f "$PKG_DIR/dist/src/index.d.ts" ] || { echo "  ✗ dist/src/index.d.ts missing"; exit 1; }
[ -f "$PKG_DIR/assets/silero_vad_v6.onnx" ] || { echo "  ✗ silero VAD asset missing"; exit 1; }
find "$PKG_DIR/whisper_bridge/build" -maxdepth 1 -type f \( -name 'libwhisper_bridge.so' -o -name 'libwhisper_bridge.dylib' -o -name 'whisper_bridge.dll' -o -name 'libwhisper_bridge.dll' \) | grep -q .
echo "  ✓ Runtime files are bundled and built"

echo "Step 5: Verify runtime dependencies were installed in the temp project..."
[ -d "$INSTALL_DIR/node_modules/onnxruntime-node" ] || { echo "  ✗ onnxruntime-node missing from clean install"; exit 1; }
[ ! -L "$INSTALL_DIR/node_modules/onnxruntime-node" ] || { echo "  ✗ onnxruntime-node should be installed, not symlinked"; exit 1; }
[ -d "$INSTALL_DIR/node_modules/koffi" ] || { echo "  ✗ koffi missing from clean install"; exit 1; }
echo "  ✓ Runtime dependencies were installed from npm"

echo "Step 6: Verify published exports..."
cd "$INSTALL_DIR"
node <<'EOF'
const mod = require("faster-whisper-ts");

const expected = [
  "WhisperModel",
  "Tokenizer",
  "FeatureExtractor",
  "SileroVADModel",
  "getSpeechTimestamps",
  "collectChunks",
  "decodeAudio",
  "padOrTrim",
  "LANGUAGE_CODES",
  "TASKS",
];

for (const key of expected) {
  if (!(key in mod)) {
    throw new Error(`root export missing: ${key}`);
  }
}

if (typeof mod.WhisperModel !== "function") {
  throw new Error("WhisperModel export is not callable");
}

console.log("  ✓ Root exports verified");
EOF

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ Smoke test passed"
echo "═══════════════════════════════════════════════════"
