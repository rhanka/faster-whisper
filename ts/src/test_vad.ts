import { decodeAudio } from './audio';
import { SileroVADModel, getSpeechTimestamps } from './vad';
import * as path from 'path';

async function testVAD() {
    console.log("Loading audio...");
    const audioPath = '/home/antoinefa/src/faster-whisper/tests/data/jfk.flac';
    const audio = await decodeAudio(audioPath) as Float32Array;

    console.log("Loading VAD model...");
    const modelPath = '/home/antoinefa/src/faster-whisper/faster_whisper/assets/silero_vad_v6.onnx';
    const vadModel = new SileroVADModel(modelPath);
    await vadModel.load();

    console.log("Running VAD...");
    const timestamps = await getSpeechTimestamps(audio, vadModel);
    console.log("Timestamps:", timestamps);
}

testVAD().catch(console.error);