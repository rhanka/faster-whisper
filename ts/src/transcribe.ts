import { WhisperModel as BridgeWhisperModel, WhisperOptions as BridgeWhisperOptions } from './whisper';
import { Tokenizer, Tokenizer as HFTokenizerWrapper, Task, LanguageCode } from './tokenizer';
import { FeatureExtractor } from './feature_extractor';
import { decodeAudio, padOrTrim } from './audio';
import { SileroVADModel, getSpeechTimestamps, collectChunks, VadOptions, SpeechSegment } from './vad';
import { Tokenizer as HFTokenizer } from '@huggingface/tokenizers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';

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

function formatTimestamp(seconds: number): string {
    const ms = Math.floor((seconds % 1) * 1000);
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return `${h.toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export class WhisperModel {
    private model: BridgeWhisperModel;
    private featureExtractor: FeatureExtractor;
    private hfTokenizer: HFTokenizer | null = null;
    public isMultilingual: boolean = false; // Simplified, assuming auto-detected or passed
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
        console.log(`[WhisperModel] Detected multilingual: ${this.isMultilingual}`);
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
        if (options.vadFilter) {
            const vadModel = new SileroVADModel(path.join(__dirname, '../../faster_whisper/assets/silero_vad_v6.onnx'));
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

        // Map back timestamps if VAD was used
        if (speechChunks && speechChunks.length > 0) {
            // Simplified mapping for POC, typically requires SpeechTimestampsMap
        }

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

        return [segments, info];
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

                console.log(`[generateSegments] Calling model.generate (seek: ${seek}, temp: ${temp})`);
                const resultArray = this.model.generate(
                    paddedSegment,
                    1,
                    80,
                    this.featureExtractor.nbMaxFrames,
                    [prompt],
                    cOptions
                );
                console.log(`[generateSegments] model.generate returned ${resultArray.length} results`);

                const result = resultArray[0]!;
                const tokens = result.tokens;
                console.log(`[generateSegments] Generated ${tokens.length} tokens`);

                const seqLen = tokens.length;
                const cumLogprob = result.score * Math.pow(seqLen, options.lengthPenalty ?? 1.0);
                const avgLogprob = cumLogprob / (seqLen + 1);

                const text = tokenizer.decode(tokens).trim();
                console.log(`[generateSegments] Decoded text: "${text}"`);
                const compressionRatio = getCompressionRatio(text);
                console.log(`[generateSegments] Compression ratio: ${compressionRatio.toFixed(2)}`);

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

            // Simple split by timestamps (simplified for POC without consecutive logic)
            let duration = segmentSize * this.featureExtractor.timePerFrame;
            const timestamps = tokens.filter((t: number) => t >= tokenizer.timestampBegin!);
            if (timestamps.length > 0 && timestamps[timestamps.length - 1] !== tokenizer.timestampBegin!) {
                const lastTimestampPos = timestamps[timestamps.length - 1] - tokenizer.timestampBegin!;
                duration = lastTimestampPos * this.timePrecision;
            }

            if (text.trim()) {
                idx++;
                segments.push({
                    id: idx,
                    seek: seek,
                    start: timeOffset,
                    end: timeOffset + duration,
                    text: text,
                    tokens: tokens,
                    temperature: usedTemperature,
                    avg_logprob: avgLogprob,
                    compression_ratio: compressionRatio,
                    no_speech_prob: result.no_speech_prob
                });
                allTokens.push(...tokens);
            }

            // Seek logic (simplified)
            let lastTimestampPosition = 0;
            let seekAdvancement = segmentSize;
            if (timestamps.length > 0 && timestamps[timestamps.length - 1] !== tokenizer.timestampBegin!) {
                lastTimestampPosition = timestamps[timestamps.length - 1] - tokenizer.timestampBegin!;
                seekAdvancement = lastTimestampPosition * this.inputStride;
            }
            
            // Prevent infinite loop if seekAdvancement is 0 or negative
            if (seekAdvancement <= 0) {
                seekAdvancement = segmentSize;
            }
            
            seek += seekAdvancement;

            if (seek >= contentFrames) break;
        }

        return segments;
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
