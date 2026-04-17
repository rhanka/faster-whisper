import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { decodeAudio } from '../src/audio';
import { WhisperModel } from '../src/transcribe';
import { getTestAssetPath, getTestModelPath } from './helpers';

interface MatrixModel {
    name: string;
    path: string;
}

function parseMatrixModels(): MatrixModel[] {
    const configured = process.env.FASTER_WHISPER_PARITY_MODELS;
    if (!configured) {
        return [{ name: 'tiny', path: getTestModelPath() }];
    }

    return configured
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const separator = entry.indexOf('=');
            if (separator === -1) {
                return { name: entry, path: entry };
            }
            return {
                name: entry.slice(0, separator),
                path: entry.slice(separator + 1),
            };
        });
}

async function assertJfkBaseline(model: WhisperModel, modelName: string) {
    const [segments, info] = await model.transcribe(getTestAssetPath('jfk.flac'), {
        beamSize: 5,
        vadFilter: true,
        languageDetectionThreshold: 0.5,
        languageDetectionSegments: 2,
    });

    const transcript = segments.map((segment) => segment.text).join(' ').toLowerCase();
    assert.match(
        transcript,
        /ask not what your country can do for you[, ]+ask what you can do for your country/,
        `${modelName}: expected JFK transcript`
    );
    assert.equal(info.language, 'en', `${modelName}: expected English language detection`);
    assert.ok(info.all_language_probs && info.all_language_probs.length > 0, `${modelName}: expected language probabilities`);
}

async function assertWordTimestamps(model: WhisperModel, modelName: string) {
    const [segments] = await model.transcribe(getTestAssetPath('jfk.flac'), {
        beamSize: 5,
        wordTimestamps: true,
        hallucinationSilenceThreshold: 1.0,
    }, 'en');

    const firstSegment = segments[0];
    assert.ok(firstSegment, `${modelName}: expected word timestamp segment`);
    const words = firstSegment.words;
    assert.ok(words && words.length > 0, `${modelName}: expected aligned words`);
    assert.equal(firstSegment.start, words[0]!.start, `${modelName}: expected segment start to follow words`);
    assert.equal(firstSegment.end, words[words.length - 1]!.end, `${modelName}: expected segment end to follow words`);
    assert.match(words.map((word) => word.word).join(''), /country/, `${modelName}: expected aligned word text`);
}

async function assertClipTimestamps(model: WhisperModel, modelName: string) {
    const audio = await decodeAudio(getTestAssetPath('jfk.flac')) as Float32Array;
    const duplicatedAudio = new Float32Array(audio.length * 2);
    duplicatedAudio.set(audio);
    duplicatedAudio.set(audio, audio.length);

    const [segments] = await model.transcribe(duplicatedAudio, {
        beamSize: 5,
        clipTimestamps: [0, 11, 11, 22],
    }, 'en');

    assert.ok(segments.length >= 2, `${modelName}: expected one segment per requested clip`);
    assert.ok(segments[0]!.start < 0.5, `${modelName}: expected first clip near zero`);
    assert.ok(segments.some((segment) => segment.start >= 10.8), `${modelName}: expected second clip timestamp`);
}

async function assertHotwords(model: WhisperModel, modelName: string) {
    const [segments] = await model.transcribe(getTestAssetPath('hotwords.mp3'), {
        beamSize: 5,
        hotwords: 'ComfyUI',
    }, 'en');

    const transcript = segments.map((segment) => segment.text).join(' ');
    assert.match(transcript, /ComfyUI/, `${modelName}: expected hotword prompt to bias transcript`);
}

async function assertLongFormAndLanguageDetection(model: WhisperModel, modelName: string) {
    const [segments, info] = await model.transcribe(getTestAssetPath('physicsworks.wav'), {
        beamSize: 5,
        languageDetectionThreshold: 0.5,
        languageDetectionSegments: 2,
    });

    const transcript = segments.map((segment) => segment.text).join(' ').toLowerCase();
    assert.equal(info.language, 'en', `${modelName}: expected English for physics fixture`);
    assert.ok(info.language_probability > 0.5, `${modelName}: expected confident language detection`);
    assert.match(transcript, /conservation of mechanical energy/, `${modelName}: expected long-form transcript content`);
    assert.match(transcript, /mechanical energy/, `${modelName}: expected later long-form transcript content`);
}

async function assertMultilingualFixture(model: WhisperModel, modelName: string) {
    const [segments, info] = await model.transcribe(getTestAssetPath('multilingual.mp3'), {
        beamSize: 5,
        languageDetectionThreshold: 0.5,
        languageDetectionSegments: 2,
    });

    const transcript = segments.map((segment) => segment.text).join(' ').toLowerCase();
    assert.equal(info.language, 'en', `${modelName}: expected English detection for multilingual fixture`);
    assert.match(transcript, /permission is hereby granted/, `${modelName}: expected multilingual fixture content`);
    assert.match(transcript, /software/, `${modelName}: expected software license wording`);
}

async function runModelMatrix(matrixModel: MatrixModel) {
    assert.ok(existsSync(matrixModel.path), `${matrixModel.name}: model path does not exist: ${matrixModel.path}`);

    const model = new WhisperModel(matrixModel.path);
    try {
        await assertJfkBaseline(model, matrixModel.name);
        await assertWordTimestamps(model, matrixModel.name);
        await assertClipTimestamps(model, matrixModel.name);
        await assertHotwords(model, matrixModel.name);
        await assertMultilingualFixture(model, matrixModel.name);
        await assertLongFormAndLanguageDetection(model, matrixModel.name);
    } finally {
        model.free();
    }
}

async function testParityMatrix() {
    const models = parseMatrixModels();
    assert.ok(models.length > 0, 'expected at least one matrix model');

    for (const matrixModel of models) {
        console.log(`Running parity matrix for ${matrixModel.name}: ${matrixModel.path}`);
        await runModelMatrix(matrixModel);
    }

    console.log('Parity matrix tests passed.');
}

testParityMatrix().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
