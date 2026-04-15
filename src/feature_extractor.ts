import koffi from 'koffi';
import { resolveBridgeLibraryPath } from './runtime_paths';

const libPath = resolveBridgeLibraryPath();
const lib = koffi.load(libPath);

const compute_mel_spectrogram = lib.func('compute_mel_spectrogram', 'void', [
    koffi.pointer('float'), // waveform
    'size_t',               // waveform_length
    koffi.pointer('float'), // out_features
    'size_t',               // expected_frames
    'size_t',               // n_mels
    'size_t',               // n_fft
    'size_t',               // hop_length
    koffi.pointer('float')  // mel_filters
]);

export class FeatureExtractor {
    public featureSize: number;
    public samplingRate: number;
    public hopLength: number;
    public chunkLength: number;
    public nFft: number;
    public nSamples: number;
    public nbMaxFrames: number;
    public timePerFrame: number;
    public melFilters: Float32Array;

    constructor(
        featureSize = 80,
        samplingRate = 16000,
        hopLength = 160,
        chunkLength = 30,
        nFft = 400
    ) {
        this.featureSize = featureSize;
        this.samplingRate = samplingRate;
        this.hopLength = hopLength;
        this.chunkLength = chunkLength;
        this.nFft = nFft;
        
        this.nSamples = chunkLength * samplingRate;
        this.nbMaxFrames = Math.floor(this.nSamples / hopLength);
        this.timePerFrame = hopLength / samplingRate;

        this.melFilters = FeatureExtractor.getMelFilters(samplingRate, nFft, featureSize);
    }

    public static getMelFilters(sr: number, nFft: number, nMels: number = 128): Float32Array {
        // Center freqs of each FFT bin
        const numFftBins = Math.floor(nFft / 2) + 1;
        const fftfreqs = new Float64Array(numFftBins);
        for (let i = 0; i < numFftBins; i++) {
            fftfreqs[i] = (i * sr) / nFft;
        }

        // 'Center freqs' of mel bands - uniformly spaced between limits
        const minMel = 0.0;
        const maxMel = 45.245640471924965;
        
        const mels = new Float64Array(nMels + 2);
        for (let i = 0; i < nMels + 2; i++) {
            mels[i] = minMel + (maxMel - minMel) * (i / (nMels + 1));
        }

        const freqs = new Float64Array(nMels + 2);
        const fMin = 0.0;
        const fSp = 200.0 / 3.0;

        const minLogHz = 1000.0;
        const minLogMel = (minLogHz - fMin) / fSp;
        const logstep = Math.log(6.4) / 27.0;

        for (let i = 0; i < nMels + 2; i++) {
            if (mels[i]! >= minLogMel) {
                freqs[i] = minLogHz * Math.exp(logstep * (mels[i]! - minLogMel));
            } else {
                freqs[i] = fMin + fSp * mels[i]!;
            }
        }

        const fdiff = new Float64Array(nMels + 1);
        for (let i = 0; i < nMels + 1; i++) {
            fdiff[i] = freqs[i + 1]! - freqs[i]!;
        }

        const weights = new Float32Array(nMels * numFftBins);

        for (let i = 0; i < nMels; i++) {
            const enorm = 2.0 / (freqs[i + 2]! - freqs[i]!);
            for (let j = 0; j < numFftBins; j++) {
                const rampLower = - (freqs[i]! - fftfreqs[j]!) / fdiff[i]!;
                const rampUpper = (freqs[i + 2]! - fftfreqs[j]!) / fdiff[i + 1]!;
                let weight = Math.max(0, Math.min(rampLower, rampUpper));
                weight *= enorm;
                weights[i * numFftBins + j] = weight;
            }
        }

        return weights;
    }

    public call(waveform: Float32Array, padding: number = 160, chunkLength?: number): Float32Array {
        let paddedWaveform = waveform;
        if (padding > 0) {
            paddedWaveform = new Float32Array(waveform.length + padding);
            paddedWaveform.set(waveform, 0); // padding at the end
        }

        let expectedFrames: number;
        if (chunkLength !== undefined) {
            this.nSamples = chunkLength * this.samplingRate;
            this.nbMaxFrames = Math.floor(this.nSamples / this.hopLength);
            expectedFrames = this.nbMaxFrames;
        } else {
            // Calculate based on actual padded waveform length, accounting for STFT center padding (nFft)
            // Python calculates n_frames = 1 + (length - n_fft) // hop_length
            // Then it drops the last frame: magnitudes = np.abs(stft[..., :-1]) ** 2
            // So expected frames = 1 + (paddedWaveform.length + this.nFft - this.nFft) / this.hopLength - 1
            // Which simplifies to:
            expectedFrames = Math.floor(paddedWaveform.length / this.hopLength);
        }

        const outFeatures = new Float32Array(expectedFrames * this.featureSize);

        compute_mel_spectrogram(
            paddedWaveform,
            paddedWaveform.length,
            outFeatures,
            expectedFrames,
            this.featureSize,
            this.nFft,
            this.hopLength,
            this.melFilters
        );

        return outFeatures;
    }
}
