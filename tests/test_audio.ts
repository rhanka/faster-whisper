import { decodeAudio, padOrTrim } from '../src/audio';
import { getTestAssetPath } from './helpers';

async function testAudio() {
    console.log("Testing decodeAudio with jfk.flac...");
    const jfkPath = getTestAssetPath('jfk.flac');
    
    try {
        const audioData = await decodeAudio(jfkPath) as Float32Array;
        console.log(`Length: ${audioData.length}`);
        
        const first5 = Array.from(audioData.slice(0, 5));
        console.log(`First 5 samples: [${first5.join(', ')}]`);
        
        console.log("\nTesting padOrTrim (padding)...");
        const padded = padOrTrim(audioData, 480000);
        console.log(`Padded length: ${padded.length}`);
        console.log(`Last element after padding: ${padded[padded.length - 1]}`);
        
        console.log("\nTesting padOrTrim (trimming)...");
        const trimmed = padOrTrim(audioData, 100);
        console.log(`Trimmed length: ${trimmed.length}`);
        
    } catch (e) {
        console.error("Error testing audio:", e);
    }
}

testAudio();
