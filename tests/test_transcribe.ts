import assert from 'node:assert/strict';
import { decodeAudio } from '../src/audio';
import { WhisperModel } from '../src/transcribe';
import { Tokenizer } from '../src/tokenizer';
import { getTestAssetPath, getTestModelPath } from './helpers';

async function testSmokeTranscription(model: WhisperModel, audioPath: string) {
    const [segments, info] = await model.transcribe(audioPath, {
        beamSize: 5,
        vadFilter: true,
        languageDetectionThreshold: 0.5,
        languageDetectionSegments: 2,
    });

    assert.ok(segments.length > 0, 'expected at least one segment');
    assert.ok(info.duration > 0, 'expected audio duration');
    assert.ok(info.duration_after_vad > 0, 'expected non-zero post-VAD duration');
    assert.ok(info.duration_after_vad <= info.duration, 'expected VAD duration to be bounded by original duration');
    assert.equal(info.language, 'en', 'expected language detection to identify English');
    assert.ok(info.all_language_probs && info.all_language_probs.length > 0, 'expected language probabilities');

    const transcript = segments.map((segment) => segment.text).join(' ').toLowerCase();
    assert.match(
        transcript,
        /ask not what your country can do for you[, ]+ask what you can do for your country/,
        'expected JFK smoke transcript'
    );
}

async function testVadTimestampRestore(model: WhisperModel, audioPath: string) {
    const audio = await decodeAudio(audioPath) as Float32Array;
    const silenceSamples = 16000;
    const paddedAudio = new Float32Array(silenceSamples + audio.length);
    paddedAudio.set(audio, silenceSamples);

    const [segments, info] = await model.transcribe(paddedAudio, {
        beamSize: 5,
        vadFilter: true,
    });

    assert.ok(segments.length > 0, 'expected segments after VAD remap');
    assert.ok(segments[0]!.start >= 0.9, `expected leading silence to be restored, got ${segments[0]!.start}`);
    assert.ok(info.duration >= 1.0, 'expected padded duration to include leading silence');
}

async function testTimestampSplitHelper(model: WhisperModel) {
    const internals = model as any;
    await internals.initTokenizer();

    const tokenizer = new Tokenizer(
        internals.hfTokenizer,
        internals.isMultilingual,
        'transcribe',
        'en'
    );

    const timestampBegin = tokenizer.timestampBegin;
    assert.ok(timestampBegin !== null, 'expected tokenizer timestamp begin');

    const textToken = tokenizer.encode(' test')[0];
    assert.ok(textToken !== undefined, 'expected at least one text token');

    const [segments, nextSeek, singleTimestampEnding] = internals.splitSegmentsByTimestamps(
        tokenizer,
        [
            timestampBegin,
            textToken,
            timestampBegin + 10,
            timestampBegin + 10,
            textToken,
            timestampBegin + 20,
            timestampBegin + 20,
        ],
        1.5,
        300,
        3.0,
        100
    );

    assert.equal(singleTimestampEnding, false, 'expected consecutive timestamps path');
    assert.equal(segments.length, 2, 'expected helper to split into two subsegments');
    assert.equal(segments[0]!.start, 1.5);
    assert.equal(segments[0]!.end, 1.7);
    assert.equal(segments[1]!.start, 1.7);
    assert.equal(segments[1]!.end, 1.9);
    assert.equal(nextSeek, 140, 'expected seek to advance to the last timestamp position');
}

async function testWordTimestampOptions(model: WhisperModel, audioPath: string) {
    const [segments] = await model.transcribe(audioPath, {
        beamSize: 5,
        wordTimestamps: true,
        hallucinationSilenceThreshold: 1.0,
    }, 'en');

    assert.ok(segments.length > 0, 'expected word timestamp segments');
    const words = segments[0]!.words;
    assert.ok(words && words.length > 0, 'expected word-level timestamps');
    assert.equal(segments[0]!.start, words[0]!.start, 'expected segment start to follow first word');
    assert.equal(segments[0]!.end, words[words.length - 1]!.end, 'expected segment end to follow last word');
    assert.match(words.map((word) => word.word).join(''), /country/, 'expected aligned words to include transcript text');
}

async function testClipTimestamps(model: WhisperModel, audioPath: string) {
    const audio = await decodeAudio(audioPath) as Float32Array;
    const duplicatedAudio = new Float32Array(audio.length * 2);
    duplicatedAudio.set(audio);
    duplicatedAudio.set(audio, audio.length);

    const [segments, info] = await model.transcribe(duplicatedAudio, {
        beamSize: 5,
        clipTimestamps: [0, 11, 11, 22],
    }, 'en');

    assert.ok(segments.length >= 2, 'expected one segment per requested clip');
    assert.ok(segments.some((segment) => segment.start >= 10.8), 'expected second clip timestamps to be preserved');
    assert.equal(info.duration_after_vad, info.duration, 'expected explicit clips to bypass VAD remapping');
}

async function testHotwords(model: WhisperModel) {
    const [segments] = await model.transcribe(getTestAssetPath('hotwords.mp3'), {
        beamSize: 5,
        hotwords: 'ComfyUI',
    }, 'en');

    const transcript = segments.map((segment) => segment.text).join(' ');
    assert.match(transcript, /ComfyUI/, 'expected hotword prompt to bias the transcript');
}

async function testTranscribe() {
    const modelPath = getTestModelPath();
    const audioPath = getTestAssetPath('jfk.flac');
    const model = new WhisperModel(modelPath);

    try {
        await testSmokeTranscription(model, audioPath);
        await testVadTimestampRestore(model, audioPath);
        await testTimestampSplitHelper(model);
        await testWordTimestampOptions(model, audioPath);
        await testClipTimestamps(model, audioPath);
        await testHotwords(model);
        console.log('Transcription tests passed.');
    } finally {
        model.free();
    }
}

testTranscribe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
