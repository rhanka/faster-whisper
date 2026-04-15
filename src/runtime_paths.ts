import { existsSync } from 'fs';
import * as path from 'path';

export function findPackageRoot(startDir: string): string {
    let currentDir = startDir;

    while (true) {
        if (existsSync(path.join(currentDir, 'package.json'))) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error(`Unable to locate package root from ${startDir}`);
        }

        currentDir = parentDir;
    }
}

export function getPackageRoot(): string {
    return findPackageRoot(__dirname);
}

export function resolveBridgeLibraryPath(): string {
    const packageRoot = getPackageRoot();
    const buildDir = path.join(packageRoot, 'whisper_bridge', 'build');

    const candidates = process.platform === 'win32'
        ? ['whisper_bridge.dll', 'libwhisper_bridge.dll']
        : process.platform === 'darwin'
            ? ['libwhisper_bridge.dylib']
            : ['libwhisper_bridge.so'];

    for (const candidate of candidates) {
        const candidatePath = path.join(buildDir, candidate);
        if (existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    throw new Error(
        `Unable to locate native whisper bridge in ${buildDir}. Expected one of: ${candidates.join(', ')}`
    );
}

export function resolveVadModelPath(): string {
    return path.join(getPackageRoot(), 'assets', 'silero_vad_v6.onnx');
}
