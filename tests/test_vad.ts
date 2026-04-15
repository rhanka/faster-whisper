import { decodeAudio } from '../src/audio';
import { SileroVADModel, getSpeechTimestamps } from '../src/vad';
import { getTestAssetPath, getVadAssetPath } from './helpers';

async function testVAD() {
    console.log("Loading audio...");
    const audioPath = getTestAssetPath('jfk.flac');
    const audio = await decodeAudio(audioPath) as Float32Array;

    console.log("Loading VAD model...");
    const modelPath = getVadAssetPath();
    const vadModel = new SileroVADModel(modelPath);
    await vadModel.load();

    console.log("Running VAD...");
    const timestamps = await getSpeechTimestamps(audio, vadModel);
    console.log("Timestamps:", timestamps);
}

testVAD().catch(console.error);
