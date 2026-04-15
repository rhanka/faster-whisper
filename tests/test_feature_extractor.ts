import { decodeAudio } from '../src/audio';
import { FeatureExtractor } from '../src/feature_extractor';
import { getTestAssetPath } from './helpers';

async function testFe() {
    console.log("Loading audio...");
    const audioPath = getTestAssetPath('jfk.flac');
    const audio = await decodeAudio(audioPath) as Float32Array;

    console.log("Extracting features...");
    const fe = new FeatureExtractor();
    const out = fe.call(audio);

    console.log("Output length:", out.length);
    console.log("First 5 values of channel 0:", out.slice(0, 5));
}

testFe().catch(console.error);
