import * as ort from 'onnxruntime-node';

export interface VadOptions {
    threshold?: number;
    negThreshold?: number | null;
    minSpeechDurationMs?: number;
    maxSpeechDurationS?: number;
    minSilenceDurationMs?: number;
    speechPadMs?: number;
    minSilenceAtMaxSpeech?: number;
    useMaxPossSilAtMaxSpeech?: boolean;
}

const defaultVadOptions: VadOptions = {
    threshold: 0.5,
    negThreshold: null,
    minSpeechDurationMs: 0,
    maxSpeechDurationS: Infinity,
    minSilenceDurationMs: 2000,
    speechPadMs: 400,
    minSilenceAtMaxSpeech: 98,
    useMaxPossSilAtMaxSpeech: true
};

export class SileroVADModel {
    private session: ort.InferenceSession | null = null;
    private path: string;

    constructor(modelPath: string) {
        this.path = modelPath;
    }

    async load() {
        if (!this.session) {
            this.session = await ort.InferenceSession.create(this.path, {
                executionProviders: ['cpu'],
                interOpNumThreads: 1,
                intraOpNumThreads: 1,
                logSeverityLevel: 4
            });
        }
    }

    async call(audio: Float32Array, numSamples: number = 512, contextSizeSamples: number = 64): Promise<Float32Array> {
        if (!this.session) {
            await this.load();
        }

        if (audio.length % numSamples !== 0) {
            throw new Error("Input size should be a multiple of numSamples");
        }

        const numSegments = Math.floor(audio.length / numSamples);
        const batchedAudio = new Float32Array(numSegments * (numSamples + contextSizeSamples));

        for (let i = 0; i < numSegments; i++) {
            const startOut = i * (numSamples + contextSizeSamples);
            const startIn = i * numSamples;

            // Context
            if (i === 0) {
                // zeros
                batchedAudio.fill(0, startOut, startOut + contextSizeSamples);
            } else {
                const prevContextStart = (i - 1) * numSamples + (numSamples - contextSizeSamples);
                batchedAudio.set(audio.subarray(prevContextStart, prevContextStart + contextSizeSamples), startOut);
            }

            // Audio
            batchedAudio.set(audio.subarray(startIn, startIn + numSamples), startOut + contextSizeSamples);
        }

        let h = new Float32Array(1 * 1 * 128);
        let c = new Float32Array(1 * 1 * 128);

        const encoderBatchSize = 10000;
        const outputs: Float32Array[] = [];

        for (let i = 0; i < numSegments; i += encoderBatchSize) {
            const batchSize = Math.min(encoderBatchSize, numSegments - i);
            const inputSlice = batchedAudio.subarray(i * (numSamples + contextSizeSamples), (i + batchSize) * (numSamples + contextSizeSamples));
            
            // Due to a bug/feature in silero_vad ONNX, we must provide correct shape.
            // Python: batched_audio[i:i+batchSize] -> [batchSize, 576]
            const inputTensor = new ort.Tensor('float32', inputSlice, [batchSize, numSamples + contextSizeSamples]);
            
            // h and c in python are (1, 1, 128). Wait!
            // Actually, if batchSize > 1, passing h as [1,1,128] might fail in JS if the model expects [2, batch, 64].
            // But if python passes [1, 1, 128], then the ONNX model probably accepts exactly [1, 1, 128] no matter the batch size,
            // or the batch size must be 1. Wait, is it really 10000? 
            // In python: `out = self.session.run(None, {"input": batched_audio[i : i + encoder_batch_size], "h": h, "c": c})`
            const hTensor = new ort.Tensor('float32', h, [1, 1, 128]);
            const cTensor = new ort.Tensor('float32', c, [1, 1, 128]);

            const feeds = { input: inputTensor, h: hTensor, c: cTensor };
            const results = await this.session!.run(feeds);

            const outputName = this.session!.outputNames[0]!;
            const outputTensor = results[outputName]!;
            outputs.push(outputTensor.data as Float32Array);
            
            h = new Float32Array(results['hn']?.data || results['h']?.data || results[this.session!.outputNames[1]!]!.data as any);
            c = new Float32Array(results['cn']?.data || results['c']?.data || results[this.session!.outputNames[2]!]!.data as any);
        }

        const totalLength = outputs.reduce((acc, val) => acc + val.length, 0);
        const out = new Float32Array(totalLength);
        let offset = 0;
        for (const output of outputs) {
            out.set(output, offset);
            offset += output.length;
        }

        return out;
    }
}

export interface SpeechSegment {
    start: number;
    end?: number;
}

export async function getSpeechTimestamps(
    audio: Float32Array,
    vadModel: SileroVADModel,
    vadOptions?: VadOptions,
    samplingRate: number = 16000
): Promise<SpeechSegment[]> {
    const options = { ...defaultVadOptions, ...vadOptions };
    const threshold = options.threshold!;
    const negThreshold = options.negThreshold ?? Math.max(threshold - 0.15, 0.01);
    const minSpeechDurationMs = options.minSpeechDurationMs!;
    const maxSpeechDurationS = options.maxSpeechDurationS!;
    const minSilenceDurationMs = options.minSilenceDurationMs!;
    const windowSizeSamples = 512;
    const speechPadMs = options.speechPadMs!;
    const minSilenceAtMaxSpeech = options.minSilenceAtMaxSpeech!;
    const useMaxPossSilAtMaxSpeech = options.useMaxPossSilAtMaxSpeech!;

    const minSpeechSamples = samplingRate * minSpeechDurationMs / 1000;
    const speechPadSamples = samplingRate * speechPadMs / 1000;
    const maxSpeechSamples = (samplingRate * maxSpeechDurationS) - windowSizeSamples - (2 * speechPadSamples);
    const minSilenceSamples = samplingRate * minSilenceDurationMs / 1000;
    const minSilenceSamplesAtMaxSpeech = samplingRate * minSilenceAtMaxSpeech / 1000;

    const audioLengthSamples = audio.length;

    // Pad audio to multiple of windowSizeSamples
    const remainder = audio.length % windowSizeSamples;
    const padLength = remainder === 0 ? 0 : windowSizeSamples - remainder;
    let paddedAudio = audio;
    if (padLength > 0) {
        paddedAudio = new Float32Array(audio.length + padLength);
        paddedAudio.set(audio);
    }

    const speechProbs = await vadModel.call(paddedAudio);

    let triggered = false;
    const speeches: SpeechSegment[] = [];
    let currentSpeech: SpeechSegment | null = null;
    let possibleEnds: { end: number, dur: number }[] = [];

    let tempEnd = 0;
    let prevEnd = 0;
    let nextStart = 0;

    for (let i = 0; i < speechProbs.length; i++) {
        const speechProb = speechProbs[i]!;
        const curSample = windowSizeSamples * i;

        if (speechProb >= threshold && tempEnd) {
            const silDur = curSample - tempEnd;
            if (silDur > minSilenceSamplesAtMaxSpeech) {
                possibleEnds.push({ end: tempEnd, dur: silDur });
            }
            tempEnd = 0;
            if (nextStart < prevEnd) {
                nextStart = curSample;
            }
        }

        if (speechProb >= threshold && !triggered) {
            triggered = true;
            currentSpeech = { start: curSample };
            continue;
        }

        if (triggered && currentSpeech && (curSample - currentSpeech.start > maxSpeechSamples)) {
            if (useMaxPossSilAtMaxSpeech && possibleEnds.length > 0) {
                // Find max duration
                let maxEnd = possibleEnds[0] as { end: number, dur: number };
                for (const p of possibleEnds) {
                    if (p.dur > maxEnd.dur) maxEnd = p;
                }
                prevEnd = maxEnd.end;
                const dur = maxEnd.dur;
                
                currentSpeech.end = prevEnd;
                speeches.push(currentSpeech);
                currentSpeech = null;
                nextStart = prevEnd + dur;

                if (nextStart < prevEnd + curSample) {
                    currentSpeech = { start: nextStart };
                } else {
                    triggered = false;
                }
                prevEnd = 0;
                nextStart = 0;
                tempEnd = 0;
                possibleEnds = [];
            } else {
                if (prevEnd) {
                    currentSpeech!.end = prevEnd;
                    speeches.push(currentSpeech!);
                    currentSpeech = null;
                    if (nextStart < prevEnd) {
                        triggered = false;
                    } else {
                        currentSpeech = { start: nextStart };
                    }
                    prevEnd = 0;
                    nextStart = 0;
                    tempEnd = 0;
                    possibleEnds = [];
                } else {
                    currentSpeech!.end = curSample;
                    speeches.push(currentSpeech!);
                    currentSpeech = null;
                    prevEnd = 0;
                    nextStart = 0;
                    tempEnd = 0;
                    triggered = false;
                    possibleEnds = [];
                    continue;
                }
            }
        }

        if (speechProb < negThreshold && triggered && currentSpeech) {
            if (!tempEnd) {
                tempEnd = curSample;
            }
            const silDurNow = curSample - tempEnd;

            if (!useMaxPossSilAtMaxSpeech && silDurNow > minSilenceSamplesAtMaxSpeech) {
                prevEnd = tempEnd;
            }

            if (silDurNow < minSilenceSamples) {
                continue;
            } else {
                currentSpeech.end = tempEnd;
                if ((currentSpeech.end - currentSpeech.start) > minSpeechSamples) {
                    speeches.push(currentSpeech);
                }
                currentSpeech = null;
                prevEnd = 0;
                nextStart = 0;
                tempEnd = 0;
                triggered = false;
                possibleEnds = [];
                continue;
            }
        }
    }

    if (currentSpeech && (audioLengthSamples - currentSpeech.start) > minSpeechSamples) {
        currentSpeech.end = audioLengthSamples;
        speeches.push(currentSpeech);
    }

    for (let i = 0; i < speeches.length; i++) {
        const speech = speeches[i]!;
        if (i === 0) {
            speech.start = Math.max(0, speech.start - speechPadSamples);
        }
        if (i !== speeches.length - 1) {
            const nextSpeech = speeches[i + 1]!;
            const silenceDuration = nextSpeech.start - speech.end!;
            if (silenceDuration < 2 * speechPadSamples) {
                speech.end! += Math.floor(silenceDuration / 2);
                nextSpeech.start = Math.max(0, nextSpeech.start - Math.floor(silenceDuration / 2));
            } else {
                speech.end! = Math.min(audioLengthSamples, speech.end! + speechPadSamples);
                nextSpeech.start = Math.max(0, nextSpeech.start - speechPadSamples);
            }
        } else {
            speech.end! = Math.min(audioLengthSamples, speech.end! + speechPadSamples);
        }
    }

    return speeches;
}

export interface ChunkMetadata {
    offset: number;
    duration: number;
    segments: SpeechSegment[];
}

export function collectChunks(
    audio: Float32Array,
    chunks: SpeechSegment[],
    samplingRate: number = 16000,
    maxDuration: number = Infinity
): [Float32Array[], ChunkMetadata[]] {
    if (!chunks || chunks.length === 0) {
        const chunkMetadata = {
            offset: 0,
            duration: 0,
            segments: []
        };
        return [[new Float32Array(0)], [chunkMetadata]];
    }

    const audioChunks: Float32Array[] = [];
    const chunksMetadata: ChunkMetadata[] = [];

    let currentSegments: SpeechSegment[] = [];
    let currentDuration = 0;
    let totalDuration = 0;
    
    let currentAudio: Float32Array = new Float32Array(0);

    for (const chunk of chunks) {
        if (currentDuration + chunk.end! - chunk.start > maxDuration * samplingRate) {
            audioChunks.push(currentAudio);
            chunksMetadata.push({
                offset: totalDuration / samplingRate,
                duration: currentDuration / samplingRate,
                segments: currentSegments
            });
            totalDuration += currentDuration;

            currentSegments = [];
            currentAudio = audio.subarray(chunk.start, chunk.end!);
            currentDuration = chunk.end! - chunk.start;
        } else {
            currentSegments.push(chunk);
            
            // Concatenate Float32Arrays
            const chunkAudio = audio.subarray(chunk.start, chunk.end!);
            const newAudio = new Float32Array(currentAudio.length + chunkAudio.length);
            newAudio.set(currentAudio);
            newAudio.set(chunkAudio, currentAudio.length);
            currentAudio = newAudio;

            currentDuration += chunk.end! - chunk.start;
        }
    }

    audioChunks.push(currentAudio);
    chunksMetadata.push({
        offset: totalDuration / samplingRate,
        duration: currentDuration / samplingRate,
        segments: currentSegments
    });

    return [audioChunks, chunksMetadata];
}
