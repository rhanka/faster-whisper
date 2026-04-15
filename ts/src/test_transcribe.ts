import { WhisperModel } from './transcribe';

async function testTranscribe() {
    const modelPath = '/home/antoinefa/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/d90ca5fe260221311c53c58e660288d3deb8d356';
    const audioPath = '/home/antoinefa/src/faster-whisper/tests/data/jfk.flac';

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