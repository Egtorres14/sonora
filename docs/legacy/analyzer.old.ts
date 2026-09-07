import { TechnicalReport } from '../types';

/**
 * Formats a time in seconds into a "M:SS.mmm" string format.
 * @param seconds The time in seconds.
 * @returns The formatted time string.
 */
const formatTimestamp = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Analyzes an audio file directly in the browser to extract objective technical metrics.
 * @param file The audio file to analyze (.wav, .aiff).
 * @param bitDepth The bit depth of the audio, obtained from header parsing.
 * @param headerSampleRate The sample rate from header parsing, used as a primary source.
 * @returns A promise that resolves with a TechnicalReport object.
 */
export const analyzeAudioClientSide = async (file: File, bitDepth: number, headerSampleRate: number): Promise<TechnicalReport> => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

    const { duration, numberOfChannels, length } = audioBuffer;
    // Prioritize header-parsed sample rate, but fall back to AudioContext's result.
    const sampleRate = headerSampleRate > 0 ? headerSampleRate : audioBuffer.sampleRate;

    let peak = 0;
    const clicks: { timestamp: string }[] = [];
    let rmsSumOfSquares = 0;
    
    const CLICK_THRESHOLD = 0.4;
    const CLICK_COOLDOWN = 0.05;

    for (let channel = 0; channel < numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        let lastSample = 0;
        for (let i = 0; i < length; i++) {
            const sample = channelData[i];
            const absSample = Math.abs(sample);

            if (absSample > peak) {
                peak = absSample;
            }
            
            rmsSumOfSquares += sample * sample;

            if (Math.abs(sample - lastSample) > CLICK_THRESHOLD) {
                const clickTime = i / sampleRate;
                const lastClickTime = clicks.length > 0 ? 
                    (parseInt(clicks[clicks.length - 1].timestamp.split(':')[0]) * 60) + parseFloat(clicks[clicks.length - 1].timestamp.split(':')[1]) : -1;
                
                if (clicks.length === 0 || (clickTime - lastClickTime) > CLICK_COOLDOWN) {
                    clicks.push({ timestamp: formatTimestamp(clickTime) });
                }
            }
            lastSample = sample;
        }
    }

    const truePeak_dBFS = 20 * Math.log10(peak);
    const isClipping = peak >= 1.0;

    const meanSquare = rmsSumOfSquares / (length * numberOfChannels);
    const rms = Math.sqrt(meanSquare);
    const loudness_LUFS = (20 * Math.log10(rms)) + 14; 

    return {
        metadata: {
            sampleRate,
            bitDepth,
            duration,
        },
        levels: {
            truePeak_dBFS: parseFloat(truePeak_dBFS.toFixed(2)),
            isClipping,
            loudness_LUFS: parseFloat(loudness_LUFS.toFixed(2)),
        },
        artifacts: {
            clicks,
        }
    };
};