const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'whisper_bridge');
const buildDir = path.join(sourceDir, 'build');
const cachePath = path.join(buildDir, 'CMakeCache.txt');

function run(command, args) {
  const result = cp.spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (fs.existsSync(cachePath)) {
  const cacheContent = fs.readFileSync(cachePath, 'utf8');
  const currentSourceMarker = `CMAKE_HOME_DIRECTORY:INTERNAL=${sourceDir}`;
  if (!cacheContent.includes(currentSourceMarker)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

run('cmake', ['-S', sourceDir, '-B', buildDir]);
run('cmake', ['--build', buildDir, '-j']);
