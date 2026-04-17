import { Tokenizer as HFTokenizer } from '@huggingface/tokenizers';

export const TASKS = ["transcribe", "translate"] as const;
export type Task = typeof TASKS[number];

export const LANGUAGE_CODES = [
    "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy", "id", "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "yi", "yo", "zh", "yue"
] as const;
export type LanguageCode = typeof LANGUAGE_CODES[number];

export class Tokenizer {
    public tokenizer: HFTokenizer;
    public task: number | null;
    public language: number | null;
    public languageCode: string;

    constructor(
        tokenizer: HFTokenizer,
        multilingual: boolean,
        task?: Task,
        language?: LanguageCode
    ) {
        this.tokenizer = tokenizer;

        if (multilingual) {
            if (task && !TASKS.includes(task)) {
                throw new Error(`'${task}' is not a valid task (accepted tasks: ${TASKS.join(', ')})`);
            }
            if (language && !LANGUAGE_CODES.includes(language)) {
                throw new Error(`'${language}' is not a valid language code (accepted language codes: ${LANGUAGE_CODES.join(', ')})`);
            }

            this.task = task ? this.getTokenId(`<|${task}|>`) : null;
            this.language = language ? this.getTokenId(`<|${language}|>`) : null;
            this.languageCode = language || 'en';
        } else {
            this.task = null;
            this.language = null;
            this.languageCode = 'en';
        }
    }

    private getTokenId(token: string): number | null {
        const id = this.tokenizer.token_to_id(token);
        return id !== undefined ? id : null;
    }

    get transcribe(): number | null { return this.getTokenId("<|transcribe|>"); }
    get translate(): number | null { return this.getTokenId("<|translate|>"); }
    get sot(): number | null { return this.getTokenId("<|startoftranscript|>"); }
    get sotLm(): number | null { return this.getTokenId("<|startoflm|>"); }
    get sotPrev(): number | null { return this.getTokenId("<|startofprev|>"); }
    get eot(): number | null { return this.getTokenId("<|endoftext|>"); }
    get noTimestamps(): number | null { return this.getTokenId("<|notimestamps|>"); }
    get noSpeech(): number | null { return this.getTokenId("<|nospeech|>") || this.getTokenId("<|nocaptions|>"); }

    get timestampBegin(): number | null {
        const noTs = this.noTimestamps;
        return noTs !== null ? noTs + 1 : null;
    }

    get sotSequence(): number[] {
        const sequence: number[] = [];
        if (this.sot !== null) sequence.push(this.sot);
        if (this.language !== null) sequence.push(this.language);
        if (this.task !== null) sequence.push(this.task);
        return sequence;
    }

    public encode(text: string): number[] {
        return Array.from(this.tokenizer.encode(text, false).ids);
    }

    public decode(tokens: number[]): string {
        const eot = this.eot;
        const textTokens = eot !== null ? tokens.filter(t => t < eot) : tokens;
        return this.tokenizer.decode(textTokens, { skip_special_tokens: false });
    }

    public decodeWithTimestamps(tokens: number[]): string {
        const outputs: (number[] | string)[] = [[]];
        const tsBegin = this.timestampBegin;

        for (const token of tokens) {
            if (tsBegin !== null && token >= tsBegin) {
                const timestamp = `<|${((token - tsBegin) * 0.02).toFixed(2)}|>`;
                outputs.push(timestamp);
                outputs.push([]);
            } else {
                (outputs[outputs.length - 1] as number[]).push(token);
            }
        }

        return outputs.map(s => {
            if (typeof s === 'string') return s;
            if (s.length === 0) return "";
            return this.tokenizer.decode(s, { skip_special_tokens: false });
        }).join('');
    }

    public get nonSpeechTokens(): number[] {
        const symbols = Array.from('"#()*+/:;<=>@[\\]^_`{|}~「」『』');
        symbols.push(..."<< >> <<< >>> -- --- -( -[ (' (\" (( )) ((( ))) [[ ]] {{ }} ♪♪ ♪♪♪".split(' '));

        const miscellaneous = new Set(Array.from('♩♪♫♬♭♮♯'));
        const result = new Set<number>();

        const dash = this.encode(' -')[0];
        const apostrophe = this.encode(" '")[0];
        if (dash !== undefined) result.add(dash);
        if (apostrophe !== undefined) result.add(apostrophe);

        for (const symbol of [...symbols, ...miscellaneous]) {
            for (const text of [symbol, ` ${symbol}`]) {
                const tokens = this.encode(text);
                if (tokens.length === 1 || miscellaneous.has(symbol)) {
                    const token = tokens[0];
                    if (token !== undefined) result.add(token);
                }
            }
        }

        return Array.from(result).sort((a, b) => a - b);
    }

    public splitToWordTokens(tokens: number[]): [string[], number[][]] {
        if (["zh", "ja", "th", "lo", "my", "yue"].includes(this.languageCode)) {
            return this.splitTokensOnUnicode(tokens);
        }

        return this.splitTokensOnSpaces(tokens);
    }

    private splitTokensOnUnicode(tokens: number[]): [string[], number[][]] {
        const decodedFull = this.decodeWithTimestamps(tokens);
        const replacementChar = '\ufffd';
        const words: string[] = [];
        const wordTokens: number[][] = [];
        let currentTokens: number[] = [];
        let unicodeOffset = 0;

        for (const token of tokens) {
            currentTokens.push(token);
            const decoded = this.decodeWithTimestamps(currentTokens);
            const replacementCharIndex = decoded.indexOf(replacementChar);
            const absoluteReplacementIndex = replacementCharIndex === -1
                ? -1
                : replacementCharIndex + unicodeOffset;

            if (
                absoluteReplacementIndex === -1
                || (
                    absoluteReplacementIndex < decodedFull.length
                    && decodedFull[absoluteReplacementIndex] === replacementChar
                )
            ) {
                words.push(decoded);
                wordTokens.push(currentTokens);
                currentTokens = [];
                unicodeOffset += decoded.length;
            }
        }

        return [words, wordTokens];
    }

    private splitTokensOnSpaces(tokens: number[]): [string[], number[][]] {
        const [subwords, subwordTokensList] = this.splitTokensOnUnicode(tokens);
        const words: string[] = [];
        const wordTokens: number[][] = [];

        for (let i = 0; i < subwords.length; i++) {
            const subword = subwords[i]!;
            const subwordTokens = subwordTokensList[i]!;
            const special = (subwordTokens[0] ?? 0) >= (this.eot ?? Number.MAX_SAFE_INTEGER);
            const withSpace = subword.startsWith(' ');
            const punctuation = subword.trim().length === 1 && punctuationChars.has(subword.trim());

            if (special || withSpace || punctuation || words.length === 0) {
                words.push(subword);
                wordTokens.push([...subwordTokens]);
            } else {
                words[words.length - 1] += subword;
                wordTokens[wordTokens.length - 1]!.push(...subwordTokens);
            }
        }

        return [words, wordTokens];
    }
}

const punctuationChars = new Set(Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'));
