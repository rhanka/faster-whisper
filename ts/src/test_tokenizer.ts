import { Tokenizer as HFTokenizer } from '@huggingface/tokenizers';
import { Tokenizer } from './tokenizer';
import * as fs from 'fs/promises';
import * as path from 'path';

async function test() {
    console.log("Loading tokenizer JSON...");
    const modelPath = '/home/antoinefa/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/d90ca5fe260221311c53c58e660288d3deb8d356';
    const jsonPath = path.join(modelPath, 'tokenizer.json');
    const jsonContent = await fs.readFile(jsonPath, 'utf8');

    const jsonObj = JSON.parse(jsonContent);
    const hfTokenizer = new HFTokenizer(jsonObj, jsonObj);
    const tokenizer = new Tokenizer(hfTokenizer, true, 'transcribe', 'en');

    console.log('sot:', tokenizer.sot);
    console.log('eot:', tokenizer.eot);
    console.log('transcribe:', tokenizer.transcribe);
    console.log('language (en):', tokenizer.language);
    console.log('noSpeech:', tokenizer.noSpeech);
    console.log('timestampBegin:', tokenizer.timestampBegin);
    
    console.log('sotSequence:', tokenizer.sotSequence);

    const encoded = tokenizer.encode("Hello world!");
    console.log('Encoded "Hello world!":', encoded);
    
    const decoded = tokenizer.decode(encoded);
    console.log('Decoded:', decoded);
    
    const withTs = [tokenizer.timestampBegin! + 50, ...encoded, tokenizer.timestampBegin! + 100];
    const decodedTs = tokenizer.decodeWithTimestamps(withTs);
    console.log('Decoded with TS:', decodedTs);
}

test().catch(console.error);