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
    all_language_probs?: Array<[string, number]>;
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
    words?: Word[];
}

interface ClipFrames {
    start: number;
    end: number;
}

interface AlignmentWord extends Word {
    tokens: number[];
}

const DEFAULT_PREPEND_PUNCTUATIONS = "\"'“¿([{-";
const DEFAULT_APPEND_PUNCTUATIONS = "\"'.。,，!！?？:：”)]}、";
const HALLUCINATION_PUNCTUATION = `${DEFAULT_PREPEND_PUNCTUATIONS}${DEFAULT_APPEND_PUNCTUATIONS}`;

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

function roundTo(value: number, digits: number): number {
    return Number(value.toFixed(digits));
}

function median(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[middle]!;
    }
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function getSegmentsEnd(segments: RawTimestampSegment[]): number | null {
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i]!;
        if (segment.words && segment.words.length > 0) {
            return segment.words[segment.words.length - 1]!.end;
        }
    }
    return segments.length > 0 ? segments[segments.length - 1]!.end : null;
}

function wordAnomalyScore(word: Word): number {
    const duration = word.end - word.start;
    let score = 0.0;
    if (word.probability < 0.15) {
        score += 1.0;
    }
    if (duration < 0.133) {
        score += (0.133 - duration) * 15;
    }
    if (duration > 2.0) {
        score += duration - 2.0;
    }
    return score;
}

function isSegmentAnomaly(segment?: RawTimestampSegment | null): boolean {
    if (!segment?.words || segment.words.length === 0) {
        return false;
    }
    const words = segment.words
        .filter((word) => !HALLUCINATION_PUNCTUATION.includes(word.word))
        .slice(0, 8);
    if (words.length === 0) {
        return false;
    }
    const score = words.reduce((sum, word) => sum + wordAnomalyScore(word), 0);
    return score >= 3 || score + 0.01 >= words.length;
}

function nextWordsSegment(segments: RawTimestampSegment[]): RawTimestampSegment | null {
    return segments.find((segment) => (segment.words?.length ?? 0) > 0) ?? null;
}

function mergePunctuations(alignment: AlignmentWord[], prepended: string, appended: string): void {
    let i = alignment.length - 2;
    let j = alignment.length - 1;
    while (i >= 0) {
        const previous = alignment[i]!;
        const following = alignment[j]!;
        if (previous.word.startsWith(' ') && prepended.includes(previous.word.trim())) {
            following.word = previous.word + following.word;
            following.tokens = [...previous.tokens, ...following.tokens];
            previous.word = '';
            previous.tokens = [];
        } else {
            j = i;
        }
        i--;
    }

    i = 0;
    j = 1;
    while (j < alignment.length) {
        const previous = alignment[i]!;
        const following = alignment[j]!;
        if (!previous.word.endsWith(' ') && appended.includes(following.word)) {
            previous.word += following.word;
            previous.tokens = [...previous.tokens, ...following.tokens];
            following.word = '';
            following.tokens = [];
        } else {
            i = j;
        }
        j++;
    }
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
        const clipTimestampsProvided = options.clipTimestamps !== undefined && options.clipTimestamps !== '0';
        if (options.vadFilter && !clipTimestampsProvided) {
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

        let actualLanguage = language;
        let languageProbability = 1.0;
        let allLanguageProbs: Array<[string, number]> | undefined;

        if (!actualLanguage) {
            if (!this.isMultilingual) {
                actualLanguage = 'en';
            } else {
                const detection = this.detectLanguageFromFeatures(
                    features,
                    expectedFrames,
                    options.clipTimestamps,
                    options.languageDetectionSegments ?? 1,
                    options.languageDetectionThreshold ?? 0.5
                );
                actualLanguage = detection.language as LanguageCode;
                languageProbability = detection.probability;
                allLanguageProbs = detection.allLanguageProbs;
            }
        } else if (!this.isMultilingual && actualLanguage !== 'en') {
            actualLanguage = 'en';
        }

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
        if (allLanguageProbs) {
            info.all_language_probs = allLanguageProbs;
        }
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
        let idx = 0;
        const seekClips = this.getSeekClips(options.clipTimestamps, contentFrames);
        let clipIndex = 0;
        let seek = seekClips[0]?.start ?? 0;
        const allTokens: number[] = [];
        let promptResetSince = 0;
        let lastSpeechTimestamp = 0.0;

        if (options.initialPrompt) {
            if (typeof options.initialPrompt === 'string') {
                allTokens.push(...tokenizer.encode(" " + options.initialPrompt.trim()));
            } else {
                allTokens.push(...options.initialPrompt);
            }
        }

        while (clipIndex < seekClips.length) {
            const seekClip = seekClips[clipIndex]!;
            const seekClipEnd = Math.min(seekClip.end, contentFrames);
            if (seek < seekClip.start) {
                seek = seekClip.start;
            }
            if (seek >= seekClipEnd) {
                clipIndex++;
                if (clipIndex < seekClips.length) {
                    seek = seekClips[clipIndex]!.start;
                }
                continue;
            }

            const timeOffset = seek * this.featureExtractor.timePerFrame;
            const windowEndTime = (seek + this.featureExtractor.nbMaxFrames) * this.featureExtractor.timePerFrame;
            const segmentSize = Math.min(this.featureExtractor.nbMaxFrames, contentFrames - seek, seekClipEnd - seek);
            const paddedSegment = this.extractPaddedSegment(features, frames, seek, segmentSize);

            const previousTokens = allTokens.slice(promptResetSince);
            if (options.multilingual && this.isMultilingual) {
                const languageResults = this.model.detectLanguage(paddedSegment, 1, 80, this.featureExtractor.nbMaxFrames)[0];
                const bestLanguage = languageResults?.[0];
                if (bestLanguage) {
                    const languageCode = bestLanguage[0].slice(2, -2) as LanguageCode;
                    tokenizer.languageCode = languageCode;
                    tokenizer.language = tokenizer.tokenizer.token_to_id(bestLanguage[0]) ?? tokenizer.language;
                }
            }

            const prompt = this.getPrompt(
                tokenizer,
                previousTokens,
                options.withoutTimestamps,
                seek === 0 ? options.prefix : undefined,
                options.hotwords ?? undefined
            );

            type DecodeCandidate = {
                result: { tokens: number[]; score: number; no_speech_prob: number };
                avgLogprob: number;
                text: string;
                compressionRatio: number;
                temperature: number;
            };
            let bestResult: DecodeCandidate | null = null;
            let usedTemperature = 0.0;
            let usedAllTemperatures = true;
            const fallbackResults: DecodeCandidate[] = [];
            const belowCompressionRatioResults: DecodeCandidate[] = [];

            const maxLength = this.getMaxLengthForPrompt(prompt, options.maxNewTokens);

            for (const temp of temperatures) {
                usedTemperature = temp;
                
                const cOptions = {
                    beam_size: temp > 0 ? 1 : (options.beamSize ?? 5),
                    patience: options.patience ?? 1.0,
                    num_hypotheses: options.bestOf ?? 5,
                    length_penalty: options.lengthPenalty ?? 1.0,
                    repetition_penalty: options.repetitionPenalty ?? 1.0,
                    no_repeat_ngram_size: options.noRepeatNgramSize ?? 0,
                    max_length: maxLength,
                    return_scores: true,
                    return_no_speech_prob: true,
                    max_initial_timestamp_index: Math.round((options.maxInitialTimestamp ?? 1.0) / this.timePrecision),
                    suppress_blank: options.suppressBlank ?? true,
                    suppress_tokens: this.getSuppressedTokens(tokenizer, options.suppressTokens),
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

                bestResult = { result, avgLogprob, text, compressionRatio, temperature: temp };
                fallbackResults.push(bestResult);
                let needsFallback = false;

                if (options.compressionRatioThreshold !== null && compressionRatio > (options.compressionRatioThreshold ?? 2.4)) {
                    needsFallback = true;
                } else {
                    belowCompressionRatioResults.push(bestResult);
                }

                if (options.logProbThreshold != null && avgLogprob < (options.logProbThreshold as number)) {
                    needsFallback = true;
                }

                if (options.noSpeechThreshold !== null && result.no_speech_prob > (options.noSpeechThreshold ?? 0.6)) {
                    if (options.logProbThreshold != null && avgLogprob < (options.logProbThreshold as number)) {
                        needsFallback = false; // silence
                    }
                }

                if (!needsFallback) {
                    usedAllTemperatures = false;
                    break;
                }
            }

            if (!bestResult && fallbackResults.length > 0) {
                bestResult = fallbackResults[0]!;
            }
            if (bestResult && usedAllTemperatures) {
                const candidates = belowCompressionRatioResults.length > 0 ? belowCompressionRatioResults : fallbackResults;
                bestResult = candidates.reduce((best, candidate) => (
                    candidate.avgLogprob > best.avgLogprob ? candidate : best
                ), candidates[0]!);
                usedTemperature = temperatures[temperatures.length - 1] ?? usedTemperature;
            }

            const { result, avgLogprob, compressionRatio } = bestResult!;
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
            const [rawSegments, nextSeek, singleTimestampEnding] = this.splitSegmentsByTimestamps(
                tokenizer,
                tokens,
                timeOffset,
                segmentSize,
                segmentSize * this.featureExtractor.timePerFrame,
                seek
            );

            seek = nextSeek;

            if (options.wordTimestamps) {
                lastSpeechTimestamp = this.addWordTimestamps(
                    [rawSegments],
                    tokenizer,
                    paddedSegment,
                    segmentSize,
                    options.prependPunctuations ?? DEFAULT_PREPEND_PUNCTUATIONS,
                    options.appendPunctuations ?? DEFAULT_APPEND_PUNCTUATIONS,
                    lastSpeechTimestamp
                );

                if (!singleTimestampEnding) {
                    const lastWordEnd = getSegmentsEnd(rawSegments);
                    if (lastWordEnd !== null && lastWordEnd > timeOffset) {
                        seek = Math.round(lastWordEnd * this.framesPerSecond);
                    }
                }

                if (options.hallucinationSilenceThreshold != null) {
                    const hallucinationSeek = this.applyHallucinationSilenceSkip(
                        rawSegments,
                        previousSeek,
                        timeOffset,
                        windowEndTime,
                        segmentSize * this.featureExtractor.timePerFrame,
                        contentFrames,
                        lastSpeechTimestamp,
                        options.hallucinationSilenceThreshold
                    );
                    if (hallucinationSeek !== null) {
                        seek = hallucinationSeek.seek;
                        if (hallucinationSeek.skipCurrentWindow) {
                            continue;
                        }
                    }
                }

                const lastWordEnd = getSegmentsEnd(rawSegments);
                if (lastWordEnd !== null) {
                    lastSpeechTimestamp = lastWordEnd;
                }
            }

            for (const rawSegment of rawSegments) {
                const segmentText = tokenizer.decode(rawSegment.tokens);
                if (rawSegment.start === rawSegment.end || !segmentText.trim()) {
                    continue;
                }

                idx++;
                const outputSegment: Segment = {
                    id: idx,
                    seek: previousSeek,
                    start: rawSegment.start,
                    end: rawSegment.end,
                    text: segmentText,
                    tokens: rawSegment.tokens,
                    temperature: usedTemperature,
                    avg_logprob: avgLogprob,
                    compression_ratio: compressionRatio,
                    no_speech_prob: result.no_speech_prob,
                };
                if (options.wordTimestamps) {
                    outputSegment.words = rawSegment.words ?? [];
                }
                segments.push(outputSegment);
                allTokens.push(...rawSegment.tokens);
            }

            if (!options.conditionOnPreviousText || usedTemperature > (options.promptResetOnTemperature ?? 0.5)) {
                promptResetSince = allTokens.length;
            }

            if (seek <= previousSeek) {
                seek = previousSeek + segmentSize;
            }
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

    private extractPaddedSegment(
        features: Float32Array,
        frames: number,
        seek: number,
        segmentSize: number
    ): Float32Array {
        const segmentFeatures = new Float32Array(80 * segmentSize);
        for (let m = 0; m < 80; m++) {
            for (let i = 0; i < segmentSize; i++) {
                segmentFeatures[m * segmentSize + i] = features[m * frames + (seek + i)] as number;
            }
        }

        const paddedSegment = new Float32Array(80 * this.featureExtractor.nbMaxFrames);
        for (let m = 0; m < 80; m++) {
            paddedSegment.set(
                segmentFeatures.subarray(m * segmentSize, (m + 1) * segmentSize),
                m * this.featureExtractor.nbMaxFrames
            );
        }

        return paddedSegment;
    }

    private getSeekClips(clipTimestamps: string | number[] | undefined, contentFrames: number): ClipFrames[] {
        let timestamps: number[] = [];

        if (typeof clipTimestamps === 'string') {
            timestamps = clipTimestamps.length > 0
                ? clipTimestamps.split(',').filter(Boolean).map((value) => Number(value))
                : [];
        } else if (Array.isArray(clipTimestamps)) {
            timestamps = [...clipTimestamps];
        }

        const seekPoints = timestamps.map((timestamp) => Math.round(timestamp * this.framesPerSecond));
        if (seekPoints.length === 0) {
            seekPoints.push(0);
        }
        if (seekPoints.length % 2 === 1) {
            seekPoints.push(contentFrames);
        }

        const clips: ClipFrames[] = [];
        for (let i = 0; i < seekPoints.length; i += 2) {
            const start = Math.max(0, Math.min(seekPoints[i]!, contentFrames));
            const end = Math.max(start, Math.min(seekPoints[i + 1]!, contentFrames));
            clips.push({ start, end });
        }

        return clips.length > 0 ? clips : [{ start: 0, end: contentFrames }];
    }

    private getMaxLengthForPrompt(prompt: number[], maxNewTokens: number | null | undefined): number {
        const maxLength = maxNewTokens == null ? this.maxLength : prompt.length + maxNewTokens;
        if (maxLength > this.maxLength) {
            throw new Error(
                `The prompt length (${prompt.length}) plus maxNewTokens exceeds the Whisper max length (${this.maxLength}).`
            );
        }

        return maxLength;
    }

    private getSuppressedTokens(tokenizer: HFTokenizerWrapper, suppressTokens: number[] | null | undefined): number[] {
        let tokens = suppressTokens === undefined ? [-1] : suppressTokens;
        let resolved: number[] = [];

        if (tokens && tokens.includes(-1)) {
            resolved = [
                ...tokens.filter((token) => token >= 0),
                ...tokenizer.nonSpeechTokens,
            ];
        } else if (tokens && tokens.length > 0) {
            resolved = [...tokens];
        }

        const specialTokens = [
            tokenizer.transcribe,
            tokenizer.translate,
            tokenizer.sot,
            tokenizer.sotPrev,
            tokenizer.sotLm,
            tokenizer.noSpeech,
        ].filter((token): token is number => token !== null);

        return Array.from(new Set([...resolved, ...specialTokens])).sort((a, b) => a - b);
    }

    private detectLanguageFromFeatures(
        features: Float32Array,
        frames: number,
        clipTimestamps: string | number[] | undefined,
        languageDetectionSegments: number,
        languageDetectionThreshold: number
    ): { language: string, probability: number, allLanguageProbs: Array<[string, number]> } {
        const firstTimestamp = this.getFirstClipTimestamp(clipTimestamps);
        const contentFrames = frames - 1;
        let seek = firstTimestamp * this.framesPerSecond < contentFrames
            ? Math.round(firstTimestamp * this.framesPerSecond)
            : 0;

        const detectedLanguageInfo = new Map<string, number[]>();
        let lastLanguageProbs: Array<[string, number]> = [];
        const maxSegments = Math.max(1, languageDetectionSegments);

        for (let segmentIndex = 0; segmentIndex < maxSegments && seek < contentFrames; segmentIndex++) {
            const segmentSize = Math.min(this.featureExtractor.nbMaxFrames, contentFrames - seek);
            const paddedSegment = this.extractPaddedSegment(features, frames, seek, segmentSize);
            const detection = this.model.detectLanguage(paddedSegment, 1, 80, this.featureExtractor.nbMaxFrames)[0] ?? [];
            lastLanguageProbs = detection.map(([token, probability]) => [token.slice(2, -2), probability]);

            const best = lastLanguageProbs[0];
            if (best) {
                const [language, probability] = best;
                if (probability > languageDetectionThreshold) {
                    return { language, probability, allLanguageProbs: lastLanguageProbs };
                }
                const values = detectedLanguageInfo.get(language) ?? [];
                values.push(probability);
                detectedLanguageInfo.set(language, values);
            }

            seek += this.featureExtractor.nbMaxFrames;
        }

        let fallbackLanguage = lastLanguageProbs[0]?.[0] ?? 'en';
        let fallbackProbability = lastLanguageProbs[0]?.[1] ?? 1.0;
        for (const [language, probabilities] of detectedLanguageInfo) {
            if (
                probabilities.length > (detectedLanguageInfo.get(fallbackLanguage)?.length ?? 0)
                || (
                    probabilities.length === (detectedLanguageInfo.get(fallbackLanguage)?.length ?? 0)
                    && Math.max(...probabilities) > fallbackProbability
                )
            ) {
                fallbackLanguage = language;
                fallbackProbability = Math.max(...probabilities);
            }
        }

        return { language: fallbackLanguage, probability: fallbackProbability, allLanguageProbs: lastLanguageProbs };
    }

    private getFirstClipTimestamp(clipTimestamps: string | number[] | undefined): number {
        if (typeof clipTimestamps === 'string') {
            const first = clipTimestamps.split(',').filter(Boolean)[0];
            return first === undefined ? 0 : Number(first);
        }
        if (Array.isArray(clipTimestamps) && clipTimestamps.length > 0) {
            return clipTimestamps[0] ?? 0;
        }
        return 0;
    }

    private addWordTimestamps(
        segments: RawTimestampSegment[][],
        tokenizer: HFTokenizerWrapper,
        segmentFeatures: Float32Array,
        numFrames: number,
        prependPunctuations: string,
        appendPunctuations: string,
        lastSpeechTimestamp: number
    ): number {
        if (segments.length === 0) {
            return lastSpeechTimestamp;
        }

        const textTokens: number[][] = [];
        const textTokensPerSegment: number[][][] = [];
        for (const segment of segments) {
            const segmentTokens = segment.map((subsegment) => (
                subsegment.tokens.filter((token) => token < (tokenizer.eot ?? Number.MAX_SAFE_INTEGER))
            ));
            textTokens.push(segmentTokens.flat());
            textTokensPerSegment.push(segmentTokens);
        }

        const alignments = this.findAlignment(tokenizer, textTokens, segmentFeatures, numFrames);
        const medianMaxDurations: Array<[number, number]> = [];

        for (const alignment of alignments) {
            const wordDurations = alignment
                .map((word) => word.end - word.start)
                .filter((duration) => duration !== 0);
            const medianDuration = Math.min(0.7, wordDurations.length > 0 ? median(wordDurations) : 0.0);
            const maxDuration = medianDuration * 2;

            if (wordDurations.length > 0) {
                const sentenceEndMarks = new Set(Array.from('.。!！?？'));
                for (let i = 1; i < alignment.length; i++) {
                    const word = alignment[i]!;
                    if (word.end - word.start > maxDuration) {
                        if (sentenceEndMarks.has(word.word)) {
                            word.end = word.start + maxDuration;
                        } else if (sentenceEndMarks.has(alignment[i - 1]!.word)) {
                            word.start = word.end - maxDuration;
                        }
                    }
                }
            }

            mergePunctuations(alignment, prependPunctuations, appendPunctuations);
            medianMaxDurations.push([medianDuration, maxDuration]);
        }

        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
            let wordIndex = 0;
            const segment = segments[segmentIndex]!;
            const timeOffset = (segment[0]?.seek ?? 0) / this.framesPerSecond;
            const [medianDuration, maxDuration] = medianMaxDurations[segmentIndex] ?? [0, 0];

            for (let subsegmentIndex = 0; subsegmentIndex < segment.length; subsegmentIndex++) {
                const subsegment = segment[subsegmentIndex]!;
                let savedTokens = 0;
                const words: Word[] = [];
                const targetTokenCount = textTokensPerSegment[segmentIndex]?.[subsegmentIndex]?.length ?? 0;

                while (wordIndex < (alignments[segmentIndex]?.length ?? 0) && savedTokens < targetTokenCount) {
                    const timing = alignments[segmentIndex]![wordIndex]!;

                    if (timing.word) {
                        words.push({
                            word: timing.word,
                            start: roundTo(timeOffset + timing.start, 2),
                            end: roundTo(timeOffset + timing.end, 2),
                            probability: timing.probability,
                        });
                    }

                    savedTokens += timing.tokens.length;
                    wordIndex++;
                }

                if (words.length > 0) {
                    if (
                        words[0]!.end - lastSpeechTimestamp > medianDuration * 4
                        && (
                            words[0]!.end - words[0]!.start > maxDuration
                            || (
                                words.length > 1
                                && words[1]!.end - words[0]!.start > maxDuration * 2
                            )
                        )
                    ) {
                        if (words.length > 1 && words[1]!.end - words[1]!.start > maxDuration) {
                            const boundary = Math.max(words[1]!.end / 2, words[1]!.end - maxDuration);
                            words[0]!.end = boundary;
                            words[1]!.start = boundary;
                        }
                        words[0]!.start = Math.max(0, words[0]!.end - maxDuration);
                    }

                    if (subsegment.start < words[0]!.end && subsegment.start - 0.5 > words[0]!.start) {
                        words[0]!.start = Math.max(0, Math.min(words[0]!.end - medianDuration, subsegment.start));
                    } else {
                        subsegment.start = words[0]!.start;
                    }

                    const lastWord = words[words.length - 1]!;
                    if (subsegment.end > lastWord.start && subsegment.end + 0.5 < lastWord.end) {
                        lastWord.end = Math.max(lastWord.start + medianDuration, subsegment.end);
                    } else {
                        subsegment.end = lastWord.end;
                    }

                    lastSpeechTimestamp = subsegment.end;
                }

                subsegment.words = words;
            }
        }

        return lastSpeechTimestamp;
    }

    private findAlignment(
        tokenizer: HFTokenizerWrapper,
        textTokens: number[][],
        segmentFeatures: Float32Array,
        numFrames: number,
        medianFilterWidth: number = 7
    ): AlignmentWord[][] {
        if (textTokens.length === 0) {
            return [];
        }

        const alignments = this.model.align(
            segmentFeatures,
            1,
            80,
            this.featureExtractor.nbMaxFrames,
            tokenizer.sotSequence,
            textTokens,
            textTokens.map(() => numFrames),
            medianFilterWidth
        );

        return alignments.map((alignment, index) => {
            const textToken = textTokens[index] ?? [];
            const textTokenProbs = alignment.textTokenProbs;
            const textIndices = alignment.alignments.map(([textIndex]) => textIndex);
            const timeIndices = alignment.alignments.map(([, timeIndex]) => timeIndex);
            const [words, wordTokens] = tokenizer.splitToWordTokens([
                ...textToken,
                tokenizer.eot ?? Number.MAX_SAFE_INTEGER,
            ]);

            if (wordTokens.length <= 1) {
                return [];
            }

            const wordBoundaries = [0];
            let cumulative = 0;
            for (const tokens of wordTokens.slice(0, -1)) {
                cumulative += tokens.length;
                wordBoundaries.push(cumulative);
            }
            if (wordBoundaries.length <= 1) {
                return [];
            }

            const jumpTimes: number[] = [];
            for (let i = 0; i < textIndices.length; i++) {
                const jump = i === 0 || textIndices[i] !== textIndices[i - 1];
                if (jump) {
                    jumpTimes.push((timeIndices[i] ?? 0) / this.tokensPerSecond);
                }
            }

            const output: AlignmentWord[] = [];
            for (let i = 0; i < wordBoundaries.length - 1; i++) {
                const start = wordBoundaries[i]!;
                const end = wordBoundaries[i + 1]!;
                const probabilities = textTokenProbs.slice(start, end);
                output.push({
                    word: words[i] ?? '',
                    tokens: wordTokens[i] ?? [],
                    start: jumpTimes[start] ?? 0,
                    end: jumpTimes[end] ?? (jumpTimes[start] ?? 0),
                    probability: probabilities.length > 0
                        ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
                        : 0,
                });
            }

            return output;
        });
    }

    private applyHallucinationSilenceSkip(
        segments: RawTimestampSegment[],
        previousSeek: number,
        timeOffset: number,
        windowEndTime: number,
        segmentDuration: number,
        contentFrames: number,
        lastSpeechTimestamp: number,
        threshold: number
    ): { seek: number, skipCurrentWindow: boolean } | null {
        const firstSegment = nextWordsSegment(segments);
        if (firstSegment && isSegmentAnomaly(firstSegment)) {
            const gap = firstSegment.start - timeOffset;
            if (gap > threshold) {
                return {
                    seek: previousSeek + Math.round(gap * this.framesPerSecond),
                    skipCurrentWindow: true,
                };
            }
        }

        let hallucinationLastEnd = lastSpeechTimestamp;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i]!;
            if (!segment.words || segment.words.length === 0) {
                continue;
            }
            if (isSegmentAnomaly(segment)) {
                const nextSegment = nextWordsSegment(segments.slice(i + 1));
                const hallucinationNextStart = nextSegment?.words?.[0]?.start ?? (timeOffset + segmentDuration);
                const silenceBefore = (
                    segment.start - hallucinationLastEnd > threshold
                    || segment.start < threshold
                    || segment.start - timeOffset < 2.0
                );
                const silenceAfter = (
                    hallucinationNextStart - segment.end > threshold
                    || isSegmentAnomaly(nextSegment)
                    || windowEndTime - segment.end < 2.0
                );

                if (silenceBefore && silenceAfter) {
                    let seek = Math.round(Math.max(timeOffset + 1, segment.start) * this.framesPerSecond);
                    if ((contentFrames / this.framesPerSecond) - segment.end < threshold) {
                        seek = contentFrames;
                    }
                    segments.splice(i);
                    return { seek, skipCurrentWindow: false };
                }
            }
            hallucinationLastEnd = segment.end;
        }

        return null;
    }

    private getPrompt(tokenizer: HFTokenizerWrapper, previousTokens: number[], withoutTimestamps: boolean = false, prefix?: string, hotwords?: string): number[] {
        const prompt: number[] = [];
        if (previousTokens.length > 0 || (hotwords && !prefix)) {
            prompt.push(tokenizer.sotPrev!);
            if (hotwords && !prefix) {
                const hotwordTokens = tokenizer.encode(" " + hotwords.trim());
                prompt.push(...hotwordTokens.slice(0, Math.floor(this.maxLength / 2) - 1));
            }
        }
        if (previousTokens.length > 0) {
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
