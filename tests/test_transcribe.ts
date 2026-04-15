import { WhisperModel } from '../src/transcribe';
import { getTestAssetPath, getTestModelPath } from './helpers';

async function testTranscribe() {
    const modelPath = getTestModelPath();
    const audioPath = getTestAssetPath('jfk.flac');

    console.log("Loading model...");
    const model = new WhisperModel(modelPath);

    console.log("Transcribing...");
    const [segments, info] = await model.transcribe(audioPath, {
        beamSize: 5,
        vadFilter: true
    });

    console.log("Transcription info:", info);
    console.log("Segments:");
    for (const segment of segments) {
        console.log(`[${segment.start.toFixed(2)} -> ${segment.end.toFixed(2)}] ${segment.text}`);
    }

    model.free();
}

testTranscribe().catch(console.error);
