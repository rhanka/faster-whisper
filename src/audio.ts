import { createFFmpeg, FFmpeg } from '@ffmpeg/ffmpeg';

// Environment detection
const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

// Singleton FFmpeg instance for browser
let ffmpegBrowser: FFmpeg | null = null;

async function getFFmpegBrowser(): Promise<FFmpeg> {
    if (!ffmpegBrowser) {
        ffmpegBrowser = createFFmpeg({ log: false });
        await ffmpegBrowser.load();
    }
    return ffmpegBrowser;
}

/**
 * Decodes the audio to a Float32Array at 16kHz mono.
 * 
 * @param inputFile Path to the input file or Buffer/Uint8Array.
 * @param samplingRate Resample the audio to this sample rate (default 16000).
 * @param splitStereo Return separate left and right channels (not fully implemented in WASM yet, defaults to false).
 * @returns A Float32Array containing the audio.
 */
export async function decodeAudio(
    inputFile: string | Buffer | Uint8Array,
    samplingRate: number = 16000,
    splitStereo: boolean = false
): Promise<Float32Array | [Float32Array, Float32Array]> {
    if (splitStereo) {
        throw new Error("splitStereo is not yet supported in this TypeScript implementation.");
    }

    if (isNode) {
        return decodeAudioNode(inputFile, samplingRate);
    } else {
        return decodeAudioBrowser(inputFile, samplingRate);
    }
}

async function decodeAudioNode(
    inputFile: string | Buffer | Uint8Array,
    samplingRate: number
): Promise<Float32Array> {
    // Dynamic imports for Node-specific modules to avoid bundling issues in browsers
    const cp = await import('child_process');
    const spawn: any = cp.spawn;
    const ffmpegStaticModule: any = await import('ffmpeg-static');
    const ffmpegStatic: string = ffmpegStaticModule.default || ffmpegStaticModule;
    
    if (!ffmpegStatic) {
        throw new Error("ffmpeg-static is not found");
    }

    return new Promise((resolve, reject) => {
        const args = [
            '-i', typeof inputFile === 'string' ? inputFile : 'pipe:0',
            '-f', 's16le',
            '-ac', '1',
            '-ar', samplingRate.toString(),
            'pipe:1'
        ];

        const child = spawn(ffmpegStatic, args);

        const chunks: Buffer[] = [];
        let totalLength = 0;

        if (child.stdout) {
            child.stdout.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
                totalLength += chunk.length;
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
                // Uncomment for debugging FFmpeg in Node.js
                // console.error(`FFmpeg stderr: ${data}`);
            });
        }

        child.on('close', (code: number | null) => {
            if (code !== 0) {
                return reject(new Error(`FFmpeg process exited with code ${code}`));
            }

            const rawData = Buffer.concat(chunks, totalLength);
            const numSamples = rawData.length / 2;
            const floatArray = new Float32Array(numSamples);

            for (let i = 0; i < numSamples; i++) {
                const int16 = rawData.readInt16LE(i * 2);
                floatArray[i] = int16 / 32768.0;
            }

            resolve(floatArray);
        });

        child.on('error', (err: Error) => {
            reject(err);
        });

        if (typeof inputFile !== 'string' && child.stdin) {
            child.stdin.write(inputFile);
            child.stdin.end();
        }
    });
}

async function decodeAudioBrowser(
    inputFile: string | Buffer | Uint8Array,
    samplingRate: number
): Promise<Float32Array> {
    const ff = await getFFmpegBrowser();
    
    const inputFileName = 'input_audio';
    const outputFileName = 'output_audio.raw';
    
    // Write file to FFmpeg virtual filesystem
    if (typeof inputFile === 'string') {
        // In browser, passing a string path might imply fetching it
        const response = await fetch(inputFile);
        const buffer = await response.arrayBuffer();
        ff.FS('writeFile', inputFileName, new Uint8Array(buffer));
    } else {
        ff.FS('writeFile', inputFileName, inputFile);
    }

    // Run FFmpeg: decode to raw PCM, 16-bit signed, little-endian, mono, 16000 Hz
    await ff.run(
        '-i', inputFileName,
        '-f', 's16le',
        '-ac', '1',
        '-ar', samplingRate.toString(),
        outputFileName
    );

    // Read the output raw PCM data
    const rawData = ff.FS('readFile', outputFileName) as Uint8Array;
    
    // Cleanup FFmpeg memory
    ff.FS('unlink', inputFileName);
    ff.FS('unlink', outputFileName);

    // Convert s16le to Float32Array
    const numSamples = rawData.length / 2;
    const floatArray = new Float32Array(numSamples);
    
    const dataView = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    for (let i = 0; i < numSamples; i++) {
        const int16 = dataView.getInt16(i * 2, true); // true for little-endian
        floatArray[i] = int16 / 32768.0;
    }

    return floatArray;
}

/**
 * Pad or trim a 1D Float32Array or a 2D array (Float32Array[]) to the desired length.
 */
export function padOrTrim(
    array: Float32Array,
    length?: number,
    axis?: number
): Float32Array;
export function padOrTrim(
    array: Float32Array[],
    length?: number,
    axis?: number
): Float32Array[];
export function padOrTrim(
    array: Float32Array | Float32Array[],
    length: number = 3000,
    axis: number = -1
): Float32Array | Float32Array[] {
    // Handle 1D Float32Array
    if (array instanceof Float32Array) {
        if (array.length === length) {
            return array;
        } else if (array.length > length) {
            // Trim
            return array.slice(0, length);
        } else {
            // Pad with zeros
            const newArray = new Float32Array(length);
            newArray.set(array);
            return newArray;
        }
    } 
    // Handle 2D Array (e.g., [n_mels, frames])
    else if (Array.isArray(array) && array[0] instanceof Float32Array) {
        // Assume axis = -1 (columns/frames)
        return array.map(row => padOrTrim(row, length));
    }

    throw new Error("Unsupported array type or dimensionality for padOrTrim");
}
