const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL_REVISION = 'd90ca5fe260221311c53c58e660288d3deb8d356';
const DEFAULT_MODEL_ID = 'Systran/faster-whisper-tiny';
const MODEL_FILES = [
  'config.json',
  'model.bin',
  'tokenizer.json',
  'vocabulary.txt',
];

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function getModelId() {
  return process.env.FASTER_WHISPER_TEST_MODEL_ID || DEFAULT_MODEL_ID;
}

function getModelRevision() {
  return process.env.FASTER_WHISPER_TEST_MODEL_REVISION || DEFAULT_MODEL_REVISION;
}

function getTargetDir() {
  if (process.env.FASTER_WHISPER_TEST_MODEL) {
    return path.resolve(process.env.FASTER_WHISPER_TEST_MODEL);
  }

  if (process.env.FASTER_WHISPER_TEST_MODEL_DIR) {
    return path.resolve(process.env.FASTER_WHISPER_TEST_MODEL_DIR);
  }

  return path.join(getRepoRoot(), 'test-models', 'faster-whisper-tiny');
}

function hasModelFiles(targetDir) {
  return MODEL_FILES.every((fileName) => fs.existsSync(path.join(targetDir, fileName)));
}

async function downloadFile(fileName, targetDir, modelId, modelRevision) {
  const url = `https://huggingface.co/${modelId}/resolve/${modelRevision}/${fileName}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${fileName} from ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(targetDir, fileName), bytes);
}

async function main() {
  const modelId = getModelId();
  const modelRevision = getModelRevision();
  const targetDir = getTargetDir();

  if (hasModelFiles(targetDir)) {
    console.log(`Test model already available in ${targetDir}`);
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const huggingFaceCacheDir = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.cache',
    'huggingface',
    'hub',
    `models--${modelId.replace('/', '--')}`,
    'snapshots',
    modelRevision
  );

  if (hasModelFiles(huggingFaceCacheDir)) {
    for (const fileName of MODEL_FILES) {
      fs.copyFileSync(path.join(huggingFaceCacheDir, fileName), path.join(targetDir, fileName));
    }
    console.log(`Copied test model from Hugging Face cache to ${targetDir}`);
    return;
  }

  console.log(`Downloading test model ${modelId}@${modelRevision} into ${targetDir}`);
  for (const fileName of MODEL_FILES) {
    await downloadFile(fileName, targetDir, modelId, modelRevision);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
