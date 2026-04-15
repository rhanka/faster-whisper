import { WhisperModel as BridgeWhisperModel } from './whisper';
import { Tokenizer, Tokenizer as HFTokenizerWrapper, Task, LanguageCode } from './tokenizer';
import { FeatureExtractor } from './feature_extractor';
import { decodeAudio } from './audio';
import { SileroVADModel, getSpeechTimestamps, collectChunks, VadOptions, SpeechSegment } from './vad';
import { Tokenizer as HFTokenizer } from '@huggingface/tokenizers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { resolveVadModelPath } from './runtime_paths';

export interface Word {
    start: number;
    end: number;
    word: string;
    probability: number;
}

export interface Segment {
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
    words?: Word[];
    temperature?: number;
}

export interface TranscriptionOptions {
    beamSize?: number;
    bestOf?: number;
    patience?: number;
    lengthPenalty?: number;
    repetitionPenalty?: number;
    noRepeatNgramSize?: number;
    temperature?: number | number[];
    compressionRatioThreshold?: number | null;
    logProbThreshold?: number | null;
    noSpeechThreshold?: number | null;
    conditionOnPreviousText?: boolean;
    promptResetOnTemperature?: number;
    initialPrompt?: string | number[];
    prefix?: string;
    suppressBlank?: boolean;
    suppressTokens?: number[] | null;
    withoutTimestamps?: boolean;
    maxInitialTimestamp?: number;
    wordTimestamps?: boolean;
    prependPunctuations?: string;
    appendPunctuations?: string;
    multilingual?: boolean;
    vadFilter?: boolean;
    vadParameters?: VadOptions;
    maxNewTokens?: number | null;
    chunkLength?: number | null;
    clipTimestamps?: string | number[];
    hallucinationSilenceThreshold?: number | null;
    hotwords?: string | null;
    languageDetectionThreshold?: number;
    languageDetectionSegments?: number;
}

export interface TranscriptionInfo {
    language: string;
    language_probability: number;
    duration: number;
    duration_after_vad: number;
    transcription_options: TranscriptionOptions;
    vad_options?: VadOptions;
}

function getCompressionRatio(text: string): number {
    const textBytes = Buffer.from(text, 'utf8');
    const compressed = zlib.deflateSync(textBytes);
    return textBytes.length / compressed.length;
}

interface RawTimestampSegment {
    seek: number;
    start: number;
    end: number;
    tokens: number[];
}

class SpeechTimestampsMap {
    private samplingRate: number;
    private timePrecision: number;
    private chunkEndSample: number[] = [];
    private totalSilenceBefore: number[] = [];

    constructor(chunks: SpeechSegment[], samplingRate: number, timePrecision: number = 2) {
        this.samplingRate = samplingRate;
        this.timePrecision = timePrecision;

        let previousEnd = 0;
        let silentSamples = 0;

        for (const chunk of chunks) {
            const chunkEnd = chunk.end ?? chunk.start;
            silentSamples += chunk.start - previousEnd;
            previousEnd = chunkEnd;

            this.chunkEndSample.push(chunkEnd - silentSamples);
            this.totalSilenceBefore.push(silentSamples / samplingRate);
        }
    }

    getOriginalTime(time: number, chunkIndex?: number, isEnd: boolean = false): number {
        const resolvedChunkIndex = chunkIndex ?? this.getChunkIndex(time, isEnd);
        const totalSilenceBefore = this.totalSilenceBefore[resolvedChunkIndex] ?? 0;
        return Number((totalSilenceBefore + time).toFixed(this.timePrecision));
    }

    getChunkIndex(time: number, isEnd: boolean = false): number {
        const sample = Math.floor(time * this.samplingRate);
        if (isEnd) {
            const exactIndex = this.chunkEndSample.indexOf(sample);
            if (exactIndex !== -1) {
                return exactIndex;
            }
        }

        let low = 0;
        let high = this.chunkEndSample.length;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (sample < (this.chunkEndSample[mid] ?? sample)) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return Math.min(low, Math.max(this.chunkEndSample.length - 1, 0));
    }
}

function restoreSpeechTimestamps(
    segments: Segment[],
    speechChunks: SpeechSegment[],
    samplingRate: number
): Segment[] {
    const timestampMap = new SpeechTimestampsMap(speechChunks, samplingRate);

    return segments.map((segment) => {
        if (segment.words && segment.words.length > 0) {
            const words = segment.words.map((word) => {
                const middle = (word.start + word.end) / 2;
                const chunkIndex = timestampMap.getChunkIndex(middle);
                return {
                    ...word,
                    start: timestampMap.getOriginalTime(word.start, chunkIndex),
                    end: timestampMap.getOriginalTime(word.end, chunkIndex),
                };
            });

            return {
                ...segment,
                start: words[0]!.start,
                end: words[words.length - 1]!.end,
                words,
            };
        }

        return {
            ...segment,
            start: timestampMap.getOriginalTime(segment.start),
            end: timestampMap.getOriginalTime(segment.end, undefined, true),
        };
    });
}

export class WhisperModel {
    private model: BridgeWhisperModel;
    private featureExtractor: FeatureExtractor;
    private hfTokenizer: HFTokenizer | null = null;
    public isMultilingual: boolean = false;
    private modelPath: string;
    
    public inputStride = 2;
    public numSamplesPerToken: number;
    public framesPerSecond: number;
    public tokensPerSecond: number;
    public timePrecision = 0.02;
    public maxLength = 448;

    constructor(
        modelPath: string,
        device: string = "cpu",
        deviceIndex: number = 0,
        computeType: string = "default"
    ) {
        this.modelPath = modelPath;
        this.model = new BridgeWhisperModel(modelPath, device, deviceIndex, computeType);
        
        // Setup FeatureExtractor
        this.featureExtractor = new FeatureExtractor();
        
        this.numSamplesPerToken = this.featureExtractor.hopLength * this.inputStride;
        this.framesPerSecond = Math.floor(this.featureExtractor.samplingRate / this.featureExtractor.hopLength);
        this.tokensPerSecond = Math.floor(this.featureExtractor.samplingRate / this.numSamplesPerToken);
    }

    async initTokenizer() {
        const tokenizerFile = path.join(this.modelPath, "tokenizer.json");
        const jsonContent = await fs.readFile(tokenizerFile, 'utf8');
        const jsonObj = JSON.parse(jsonContent);
        this.hfTokenizer = new HFTokenizer(jsonObj, jsonObj);
        
        // Detect if multilingual by looking for <|fr|> or similar tokens
        const frToken = this.hfTokenizer.token_to_id('<|fr|>');
        this.isMultilingual = frToken !== undefined;
    }

    public free() {
        this.model.free();
    }

    async transcribe(
        audioData: string | Buffer | Uint8Array | Float32Array,
        options: TranscriptionOptions = {},
        language?: LanguageCode,
        task: Task = "transcribe"
    ): Promise<[Segment[], TranscriptionInfo]> {
        this.validateDeferredOptions(options);

        const samplingRate = this.featureExtractor.samplingRate;
        let audio: Float32Array;

        if (audioData instanceof Float32Array) {
            audio = audioData;
        } else {
            audio = await decodeAudio(audioData, samplingRate) as Float32Array;
        }

        let duration = audio.length / samplingRate;
        let durationAfterVad = duration;

        let speechChunks: SpeechSegment[] | null = null;
        if (options.vadFilter) {
            const vadModel = new SileroVADModel(resolveVadModelPath());
            await vadModel.load();
            speechChunks = await getSpeechTimestamps(audio, vadModel, options.vadParameters);
            const [audioChunks] = collectChunks(audio, speechChunks);
            
            // Flatten audio chunks
            const totalLen = audioChunks.reduce((acc, val) => acc + val.length, 0);
            const flattenedAudio = new Float32Array(totalLen);
            let offset = 0;
            for (const chunk of audioChunks) {
                flattenedAudio.set(chunk, offset);
                offset += chunk.length;
            }
            audio = flattenedAudio;
            durationAfterVad = audio.length / samplingRate;
        }

        const features = this.featureExtractor.call(audio, 160, options.chunkLength || undefined);
        // features is [frames * 80]. CTranslate2 expects [batch, 80, frames].
        const expectedFrames = features.length / 80;
        
        if (!this.hfTokenizer) {
            await this.initTokenizer();
        }

        const actualLanguage = language || 'en';
        let languageProbability = 1.0;

        const tokenizer = new HFTokenizerWrapper(
            this.hfTokenizer!,
            this.isMultilingual,
            task,
            actualLanguage as LanguageCode
        );

        const temperatures = Array.isArray(options.temperature) ? options.temperature : [options.temperature ?? 0.0];

        const segments = await this.generateSegments(features, expectedFrames, tokenizer, options, temperatures);

        const info: TranscriptionInfo = {
            language: actualLanguage,
            language_probability: languageProbability,
            duration,
            duration_after_vad: durationAfterVad,
            transcription_options: options
        };
        if (options.vadParameters) {
            info.vad_options = options.vadParameters;
        }

        const outputSegments = speechChunks && speechChunks.length > 0
            ? restoreSpeechTimestamps(segments, speechChunks, samplingRate)
            : segments;

        return [outputSegments, info];
    }

    private async generateSegments(
        features: Float32Array,
        frames: number,
        tokenizer: HFTokenizerWrapper,
        options: TranscriptionOptions,
        temperatures: number[]
    ): Promise<Segment[]> {
        const contentFrames = frames - 1;
        const segments: Segment[] = [];
        let seek = 0;
        let idx = 0;
        const allTokens: number[] = [];
        let promptResetSince = 0;

        if (options.initialPrompt) {
            if (typeof options.initialPrompt === 'string') {
                allTokens.push(...tokenizer.encode(" " + options.initialPrompt.trim()));
            } else {
                allTokens.push(...options.initialPrompt);
            }
        }

        while (seek < contentFrames) {
            const timeOffset = seek * this.featureExtractor.timePerFrame;
            const segmentSize = Math.min(this.featureExtractor.nbMaxFrames, contentFrames - seek);
            
            // Extract [80, segmentSize] from [80, frames]
            const segmentFeatures = new Float32Array(80 * segmentSize);
            for (let m = 0; m < 80; m++) {
                for (let i = 0; i < segmentSize; i++) {
                    segmentFeatures[m * segmentSize + i] = features[m * frames + (seek + i)] as number;
                }
            }

            // Pad to nbMaxFrames
            const paddedSegment = new Float32Array(80 * this.featureExtractor.nbMaxFrames);
            for (let m = 0; m < 80; m++) {
                paddedSegment.set(segmentFeatures.subarray(m * segmentSize, (m + 1) * segmentSize), m * this.featureExtractor.nbMaxFrames);
            }

            const previousTokens = allTokens.slice(promptResetSince);
            const prompt = this.getPrompt(tokenizer, previousTokens, options.withoutTimestamps, seek === 0 ? options.prefix : undefined);

            let bestResult = null;
            let bestAvgLogProb = -Infinity;
            let usedTemperature = 0.0;
            let needsFallback = false;

            for (const temp of temperatures) {
                usedTemperature = temp;
                
                let suppressTokens = options.suppressTokens;
                if (suppressTokens === undefined) suppressTokens = [-1]; // Default

                const cOptions = {
                    beam_size: temp > 0 ? 1 : (options.beamSize ?? 5),
                    patience: options.patience ?? 1.0,
                    num_hypotheses: options.bestOf ?? 5,
                    length_penalty: options.lengthPenalty ?? 1.0,
                    repetition_penalty: options.repetitionPenalty ?? 1.0,
                    no_repeat_ngram_size: options.noRepeatNgramSize ?? 0,
                    max_length: this.maxLength,
                    return_scores: true,
                    return_no_speech_prob: true,
                    max_initial_timestamp_index: Math.round((options.maxInitialTimestamp ?? 1.0) / this.timePrecision),
                    suppress_blank: options.suppressBlank ?? true,
                    suppress_tokens: suppressTokens,
                    sampling_topk: 0,
                    sampling_temperature: temp
                };

                const resultArray = this.model.generate(
                    paddedSegment,
                    1,
                    80,
                    this.featureExtractor.nbMaxFrames,
                    [prompt],
                    cOptions
                );
                const result = resultArray[0]!;
                const tokens = result.tokens;

                const seqLen = tokens.length;
                const cumLogprob = result.score * Math.pow(seqLen, options.lengthPenalty ?? 1.0);
                const avgLogprob = cumLogprob / (seqLen + 1);

                const text = tokenizer.decode(tokens).trim();
                const compressionRatio = getCompressionRatio(text);

                bestResult = { result, avgLogprob, text, compressionRatio };
                needsFallback = false;

                if (options.compressionRatioThreshold !== null && compressionRatio > (options.compressionRatioThreshold ?? 2.4)) {
                    needsFallback = true;
                }

                if (options.logProbThreshold != null && avgLogprob < (options.logProbThreshold as number)) {
                    needsFallback = true;
                }

                if (options.noSpeechThreshold !== null && result.no_speech_prob > (options.noSpeechThreshold ?? 0.6)) {
                    if (options.logProbThreshold != null && avgLogprob < (options.logProbThreshold as number)) {
                        needsFallback = false; // silence
                    }
                }

                if (!needsFallback) break;
            }

            const { result, avgLogprob, text, compressionRatio } = bestResult!;
            const tokens = result.tokens;

            if (options.noSpeechThreshold != null) {
                let shouldSkip = result.no_speech_prob > options.noSpeechThreshold;
                if (options.logProbThreshold != null && avgLogprob > options.logProbThreshold) {
                    shouldSkip = false;
                }
                if (shouldSkip) {
                    seek += segmentSize;
                    continue;
                }
            }

            const previousSeek = seek;
            const [rawSegments, nextSeek] = this.splitSegmentsByTimestamps(
                tokenizer,
                tokens,
                timeOffset,
                segmentSize,
                segmentSize * this.featureExtractor.timePerFrame,
                seek
            );

            seek = nextSeek;
            for (const rawSegment of rawSegments) {
                const segmentText = tokenizer.decode(rawSegment.tokens);
                if (rawSegment.start === rawSegment.end || !segmentText.trim()) {
                    continue;
                }

                idx++;
                segments.push({
                    id: idx,
                    seek: previousSeek,
                    start: rawSegment.start,
                    end: rawSegment.end,
                    text: segmentText,
                    tokens: rawSegment.tokens,
                    temperature: usedTemperature,
                    avg_logprob: avgLogprob,
                    compression_ratio: compressionRatio,
                    no_speech_prob: result.no_speech_prob
                });
                allTokens.push(...rawSegment.tokens);
            }

            if (!options.conditionOnPreviousText || usedTemperature > (options.promptResetOnTemperature ?? 0.5)) {
                promptResetSince = allTokens.length;
            }

            if (seek <= previousSeek) {
                seek = previousSeek + segmentSize;
            }

            if (seek >= contentFrames) break;
        }

        return segments;
    }

    private splitSegmentsByTimestamps(
        tokenizer: HFTokenizerWrapper,
        tokens: number[],
        timeOffset: number,
        segmentSize: number,
        segmentDuration: number,
        seek: number
    ): [RawTimestampSegment[], number, boolean] {
        const currentSegments: RawTimestampSegment[] = [];
        const timestampBegin = tokenizer.timestampBegin;

        if (timestampBegin === null) {
            currentSegments.push({
                seek,
                start: timeOffset,
                end: timeOffset + segmentDuration,
                tokens,
            });
            return [currentSegments, seek + segmentSize, false];
        }

        const singleTimestampEnding = (
            tokens.length >= 2
            && tokens[tokens.length - 2]! < timestampBegin
            && tokens[tokens.length - 1]! >= timestampBegin
        );

        const consecutiveTimestamps: number[] = [];
        for (let i = 1; i < tokens.length; i++) {
            if (tokens[i]! >= timestampBegin && tokens[i - 1]! >= timestampBegin) {
                consecutiveTimestamps.push(i);
            }
        }

        if (consecutiveTimestamps.length > 0) {
            const slices = [...consecutiveTimestamps];
            if (singleTimestampEnding) {
                slices.push(tokens.length);
            }

            let lastSlice = 0;
            for (const currentSlice of slices) {
                const slicedTokens = tokens.slice(lastSlice, currentSlice);
                if (slicedTokens.length === 0) {
                    lastSlice = currentSlice;
                    continue;
                }

                const startTimestampPosition = Math.max(0, slicedTokens[0]! - timestampBegin);
                const endTimestampPosition = Math.max(
                    startTimestampPosition,
                    slicedTokens[slicedTokens.length - 1]! - timestampBegin
                );

                currentSegments.push({
                    seek,
                    start: timeOffset + startTimestampPosition * this.timePrecision,
                    end: timeOffset + endTimestampPosition * this.timePrecision,
                    tokens: slicedTokens,
                });
                lastSlice = currentSlice;
            }

            if (singleTimestampEnding) {
                seek += segmentSize;
            } else {
                const lastTimestampPosition = Math.max(
                    0,
                    (tokens[lastSlice - 1] ?? timestampBegin) - timestampBegin
                );
                seek += lastTimestampPosition * this.inputStride;
            }
        } else {
            let duration = segmentDuration;
            const timestamps = tokens.filter((token) => token >= timestampBegin);
            if (timestamps.length > 0 && timestamps[timestamps.length - 1] !== timestampBegin) {
                const lastTimestampPosition = timestamps[timestamps.length - 1]! - timestampBegin;
                duration = lastTimestampPosition * this.timePrecision;
            }

            currentSegments.push({
                seek,
                start: timeOffset,
                end: timeOffset + duration,
                tokens,
            });

            seek += segmentSize;
        }

        return [currentSegments, seek, singleTimestampEnding];
    }

    private validateDeferredOptions(options: TranscriptionOptions): void {
        const deferredOptions: string[] = [];

        if (options.wordTimestamps) deferredOptions.push('wordTimestamps');
        if (options.clipTimestamps !== undefined) deferredOptions.push('clipTimestamps');
        if (options.hallucinationSilenceThreshold != null) deferredOptions.push('hallucinationSilenceThreshold');
        if (options.hotwords != null) deferredOptions.push('hotwords');
        if (options.languageDetectionThreshold !== undefined) deferredOptions.push('languageDetectionThreshold');
        if (options.languageDetectionSegments !== undefined) deferredOptions.push('languageDetectionSegments');

        if (deferredOptions.length > 0) {
            throw new Error(
                `Unsupported transcription option(s) in the current TypeScript port: ${deferredOptions.join(', ')}`
            );
        }
    }

    private getPrompt(tokenizer: HFTokenizerWrapper, previousTokens: number[], withoutTimestamps: boolean = false, prefix?: string): number[] {
        const prompt: number[] = [];
        if (previousTokens.length > 0) {
            prompt.push(tokenizer.sotPrev!);
            prompt.push(...previousTokens.slice(-(Math.floor(this.maxLength / 2) - 1)));
        }

        prompt.push(...tokenizer.sotSequence);

        if (withoutTimestamps) {
            prompt.push(tokenizer.noTimestamps!);
        }

        if (prefix) {
            const prefixTokens = tokenizer.encode(" " + prefix.trim());
            const slicedPrefix = prefixTokens.slice(0, Math.floor(this.maxLength / 2) - 1);
            if (!withoutTimestamps) {
                prompt.push(tokenizer.timestampBegin!);
            }
            prompt.push(...slicedPrefix);
        }

        return prompt;
    }
}
