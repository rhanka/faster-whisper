const fs = require('fs');
const path = require('path');

const MODEL_REVISION = 'd90ca5fe260221311c53c58e660288d3deb8d356';
const MODEL_ID = 'Systran/faster-whisper-tiny';
const MODEL_FILES = [
  'config.json',
  'model.bin',
  'tokenizer.json',
  'vocabulary.txt',
];

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function getTargetDir() {
  if (process.env.FASTER_WHISPER_TEST_MODEL) {
    return path.resolve(process.env.FASTER_WHISPER_TEST_MODEL);
  }

  return path.join(getRepoRoot(), 'test-models', 'faster-whisper-tiny');
}

function hasModelFiles(targetDir) {
  return MODEL_FILES.every((fileName) => fs.existsSync(path.join(targetDir, fileName)));
}

async function downloadFile(fileName, targetDir) {
  const url = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${fileName}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${fileName} from ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(targetDir, fileName), bytes);
}

async function main() {
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
    `models--${MODEL_ID.replace('/', '--')}`,
    'snapshots',
    MODEL_REVISION
  );

  if (hasModelFiles(huggingFaceCacheDir)) {
    for (const fileName of MODEL_FILES) {
      fs.copyFileSync(path.join(huggingFaceCacheDir, fileName), path.join(targetDir, fileName));
    }
    console.log(`Copied test model from Hugging Face cache to ${targetDir}`);
    return;
  }

  console.log(`Downloading test model ${MODEL_ID}@${MODEL_REVISION} into ${targetDir}`);
  for (const fileName of MODEL_FILES) {
    await downloadFile(fileName, targetDir);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
