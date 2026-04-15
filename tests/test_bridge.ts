import { WhisperModel } from '../src/whisper';
import { getTestModelPath } from './helpers';

const modelPath = getTestModelPath();

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
