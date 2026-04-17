import koffi from 'koffi';
import { resolveBridgeLibraryPath } from './runtime_paths';

const libPath = resolveBridgeLibraryPath();
const lib = koffi.load(libPath);

const WhisperModelHandle = koffi.pointer('WhisperModelHandle', koffi.opaque());

export const WhisperOptions = koffi.struct('WhisperOptions', {
    beam_size: 'int',
    patience: 'float',
    num_hypotheses: 'int',
    length_penalty: 'float',
    repetition_penalty: 'float',
    no_repeat_ngram_size: 'int',
    max_length: 'int',
    return_scores: 'bool',
    return_no_speech_prob: 'bool',
    max_initial_timestamp_index: 'int',
    suppress_blank: 'bool',
    suppress_tokens: koffi.pointer('int'),
    suppress_tokens_length: 'size_t',
    sampling_topk: 'int',
    sampling_temperature: 'float'
});

export const WhisperResult = koffi.struct('WhisperResult', {
    sequences: koffi.pointer(koffi.pointer('int')),
    sequences_lengths: koffi.pointer('size_t'),
    num_sequences: 'size_t',
    scores: koffi.pointer('float'),
    no_speech_prob: 'float'
});

const whisper_init = lib.func('whisper_init', WhisperModelHandle, ['str', 'str', 'int', 'str']);
const whisper_free = lib.func('whisper_free', 'void', [WhisperModelHandle]);
const whisper_generate = lib.func('whisper_generate', koffi.pointer(WhisperResult), [
    WhisperModelHandle,
    koffi.pointer('float'),
    'size_t',
    'size_t',
    'size_t',
    koffi.pointer('int'),
    koffi.pointer('size_t'),
    koffi.pointer(WhisperOptions)
]);
const whisper_free_result = lib.func('whisper_free_result', 'void', [koffi.pointer(WhisperResult)]);
const whisper_detect_language_json = lib.func('whisper_detect_language_json', 'str', [
    WhisperModelHandle,
    koffi.pointer('float'),
    'size_t',
    'size_t',
    'size_t'
]);
const whisper_align_json = lib.func('whisper_align_json', 'str', [
    WhisperModelHandle,
    koffi.pointer('float'),
    'size_t',
    'size_t',
    'size_t',
    koffi.pointer('int'),
    'size_t',
    koffi.pointer('int'),
    koffi.pointer('size_t'),
    'size_t',
    koffi.pointer('size_t'),
    'size_t'
]);

export interface WhisperAlignment {
    alignments: Array<[number, number]>;
    textTokenProbs: number[];
}

function decodeJsonString<T>(json: string | null, context: string): T {
    if (!json) {
        throw new Error(`${context} returned null`);
    }

    return JSON.parse(json) as T;
}

export class WhisperModel {
    private handle: any;

    constructor(modelPath: string, device: string = 'cpu', deviceIndex: number = 0, computeType: string = 'default') {
        this.handle = whisper_init(modelPath, device, deviceIndex, computeType);
        if (!this.handle) {
            throw new Error('Failed to initialize Whisper model. Ensure the path is correct and model exists.');
        }
    }

    public generate(
        features: Float32Array, 
        batchSize: number, 
        nMels: number, 
        chunkLength: number, 
        prompts: number[][], // Array of prompts, where each prompt is an array of token IDs
        options: any // You can type this properly based on WhisperOptions
    ): any[] {
        // Flatten prompts
        let totalPromptLength = 0;
        for (const prompt of prompts) {
            totalPromptLength += prompt.length;
        }

        const promptDataFlat = new Int32Array(totalPromptLength);
        const promptLengths = new BigUint64Array(prompts.length);

        let offset = 0;
        let i = 0;
        for (const prompt of prompts) {
            promptLengths[i] = BigInt(prompt.length);
            for (let j = 0; j < prompt.length; j++) {
                promptDataFlat[offset++] = prompt[j]!;
            }
            i++;
        }

        // Handle suppress_tokens
        let suppressTokensArray: Int32Array | null = null;
        if (options.suppress_tokens && options.suppress_tokens.length > 0) {
            suppressTokensArray = new Int32Array(options.suppress_tokens);
        }

        const cOptions = {
            beam_size: options.beam_size ?? 5,
            patience: options.patience ?? 1.0,
            num_hypotheses: options.num_hypotheses ?? 1,
            length_penalty: options.length_penalty ?? 1.0,
            repetition_penalty: options.repetition_penalty ?? 1.0,
            no_repeat_ngram_size: options.no_repeat_ngram_size ?? 0,
            max_length: options.max_length ?? 448,
            return_scores: options.return_scores ?? false,
            return_no_speech_prob: options.return_no_speech_prob ?? false,
            max_initial_timestamp_index: options.max_initial_timestamp_index ?? 50,
            suppress_blank: options.suppress_blank ?? true,
            suppress_tokens: suppressTokensArray,
            suppress_tokens_length: suppressTokensArray ? suppressTokensArray.length : 0,
            sampling_topk: options.sampling_topk ?? 1,
            sampling_temperature: options.sampling_temperature ?? 1.0
        };

        const resultPtr = whisper_generate(
            this.handle,
            features,
            batchSize,
            nMels,
            chunkLength,
            promptDataFlat,
            promptLengths,
            cOptions
        );

        if (!resultPtr) {
            throw new Error('whisper_generate returned null');
        }

        const resultData = koffi.decode(resultPtr, WhisperResult);
        const results = [];

        const numSequences = Number(resultData.num_sequences);
        
        // Sequences is a pointer to pointers
        const seqPointers = koffi.decode(resultData.sequences, koffi.array(koffi.pointer('int'), numSequences));
        const seqLengths = koffi.decode(resultData.sequences_lengths, koffi.array('size_t', numSequences));
        
        let scoresArray = null;
        if (cOptions.return_scores && resultData.scores) {
            scoresArray = koffi.decode(resultData.scores, koffi.array('float', numSequences));
        }

        for (let i = 0; i < numSequences; i++) {
            const len = Number(seqLengths[i]);
            const seqTokens = koffi.decode(seqPointers[i], koffi.array('int', len));
            results.push({
                tokens: Array.from(seqTokens),
                score: scoresArray ? scoresArray[i] : 0,
                no_speech_prob: resultData.no_speech_prob
            });
        }

        whisper_free_result(resultPtr);

        return results;
    }

    public detectLanguage(
        features: Float32Array,
        batchSize: number,
        nMels: number,
        chunkLength: number
    ): Array<Array<[string, number]>> {
        const json = whisper_detect_language_json(
            this.handle,
            features,
            batchSize,
            nMels,
            chunkLength
        );

        return decodeJsonString<Array<Array<[string, number]>>>(json, 'whisper_detect_language_json');
    }

    public align(
        features: Float32Array,
        batchSize: number,
        nMels: number,
        chunkLength: number,
        startSequence: number[],
        textTokens: number[][],
        numFrames: number[],
        medianFilterWidth: number = 7
    ): WhisperAlignment[] {
        const startSequenceData = new Int32Array(startSequence);
        const totalTextTokens = textTokens.reduce((sum, tokens) => sum + tokens.length, 0);
        const textTokensFlat = new Int32Array(totalTextTokens);
        const textTokenLengths = new BigUint64Array(textTokens.length);
        const numFramesData = new BigUint64Array(numFrames.length);

        let offset = 0;
        for (let i = 0; i < textTokens.length; i++) {
            const tokens = textTokens[i]!;
            textTokenLengths[i] = BigInt(tokens.length);
            numFramesData[i] = BigInt(numFrames[i] ?? chunkLength);
            textTokensFlat.set(tokens, offset);
            offset += tokens.length;
        }

        const json = whisper_align_json(
            this.handle,
            features,
            batchSize,
            nMels,
            chunkLength,
            startSequenceData,
            startSequenceData.length,
            textTokensFlat,
            textTokenLengths,
            textTokens.length,
            numFramesData,
            medianFilterWidth
        );

        const decoded = decodeJsonString<Array<{ alignments: Array<[number, number]>, text_token_probs: number[] }>>(
            json,
            'whisper_align_json'
        );

        return decoded.map((item) => ({
            alignments: item.alignments,
            textTokenProbs: item.text_token_probs,
        }));
    }

    public free(): void {
        if (this.handle) {
            whisper_free(this.handle);
            this.handle = null;
        }
    }
}
