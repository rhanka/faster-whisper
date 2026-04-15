import { decodeAudio } from './audio';
import { FeatureExtractor } from './feature_extractor';

async function testFe() {
    console.log("Loading audio...");
    const audioPath = '/home/antoinefa/src/faster-whisper/tests/data/jfk.flac';
    const audio = await decodeAudio(audioPath) as Float32Array;

    console.log("Extracting features...");
    const fe = new FeatureExtractor();
    
    // In Python: mels = fe(audio). This calls __call__ without chunk_length
    // In Python: def __call__(self, waveform: np.ndarray, padding=160, chunk_length=None)
    // Python returns log_spec which has shape [80, 1101] for jfk.flac without chunk_length.
    // Wait, in my TS implementation, expectedFrames is this.nbMaxFrames, which is set to 3000 if chunk_length=30.
    // But if chunk_length is undefined during call, nbMaxFrames is still 3000!
    // In python: if chunk_length is not None: self.nb_max_frames = ...
    // So python's STFT outputs frames based on the input length!
    // Wait, my C++ compute_mel_spectrogram computes exactly expected_frames, which is passed as nbMaxFrames (3000).
    // Let me set expected_frames based on the actual audio length if chunk_length is undefined.
    
    const paddedLength = audio.length + 160;
    const n_frames = 1 + Math.floor((paddedLength - fe.nFft) / fe.hopLength);
    const out = fe.call(audio);
    
    // We expect the shape to be [80, n_frames] or [80, 3000].
    // Let's print the first 5 values of the first channel.
    // My C++ writes [m * expected_frames + i]. So out[0] to out[4] are the first 5 values of the first mel channel.
    
    console.log("Output length:", out.length);
    console.log("First 5 values of channel 0:", out.slice(0, 5));
}

testFe().catch(console.error);