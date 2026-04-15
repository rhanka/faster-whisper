import { WhisperModel } from './whisper';

const modelPath = '/home/antoinefa/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/d90ca5fe260221311c53c58e660288d3deb8d356';

try {
    console.log('Loading model...');
    const model = new WhisperModel(modelPath, 'cpu', 0, 'float32');
    console.log('Model loaded successfully!');

    console.log('Freeing model...');
    model.free();
    console.log('Model freed successfully!');
} catch (err) {
    console.error('Error:', err);
}
