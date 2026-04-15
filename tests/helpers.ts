import * as os from 'os';
import * as path from 'path';
import { existsSync } from 'fs';
import { findPackageRoot, resolveVadModelPath } from '../src/runtime_paths';

const DEFAULT_MODEL_ID = 'models--Systran--faster-whisper-tiny/snapshots/d90ca5fe260221311c53c58e660288d3deb8d356';
const REPO_LOCAL_MODEL_DIR = path.join('test-models', 'faster-whisper-tiny');

export function getPackageRoot(): string {
    return findPackageRoot(__dirname);
}

export function getTestAssetPath(fileName: string): string {
    return path.join(getPackageRoot(), 'tests', 'data', fileName);
}

export function getTestModelPath(): string {
    if (process.env.FASTER_WHISPER_TEST_MODEL) {
        return process.env.FASTER_WHISPER_TEST_MODEL;
    }

    const repoLocalModelPath = path.join(getPackageRoot(), REPO_LOCAL_MODEL_DIR);
    if (existsSync(repoLocalModelPath)) {
        return repoLocalModelPath;
    }

    return path.join(os.homedir(), '.cache', 'huggingface', 'hub', DEFAULT_MODEL_ID);
}

export function getVadAssetPath(): string {
    return resolveVadModelPath();
}
