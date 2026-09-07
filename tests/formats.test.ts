import { describe, expect, it } from 'vitest';
import { decodePcm, encodeWav16, encodeWavFloat32, parseAudioHeader } from '../services/audio/wav';

describe('Formato de origen y datos PCM válidos', () => {
  it('lee sample rate y bits reales de STREAMINFO FLAC, sin asumir 48 kHz', () => {
    const bytes = new Uint8Array(42); bytes.set([102, 76, 97, 67, 128, 0, 0, 34]);
    const packed = (44100n << 44n) | (1n << 41n) | (23n << 36n) | 44100n;
    new DataView(bytes.buffer).setBigUint64(18, packed, false);
    const header = parseAudioHeader(bytes.buffer)!;
    expect(header.sampleRate).toBe(44100); expect(header.bitDepth).toBe(24); expect(header.numChannels).toBe(2);
    expect(decodePcm(bytes.buffer)).toBeNull();
  });
  it('rechaza muestras float no finitas antes de puntuar', () => {
    const buffer = encodeWav16([new Float32Array(100)], 48000);
    const view = new DataView(buffer); view.setUint16(20, 3, true); view.setUint16(34, 32, true); view.setFloat32(44, NaN, true);
    expect(() => decodePcm(buffer)).toThrow(/finita/i);
  });
  it('prepara reproducción WAV sin recortar valores ni reducir resolución', () => {
    const source = new Float32Array([0, 0.0000001, 0.5, 1.1, -1.1]);
    const decoded = decodePcm(encodeWavFloat32([source, source], 44100))!;
    expect(decoded.channels[0]).toEqual(source);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.sampleFormat).toBe('float');
    expect(decoded.channels).toHaveLength(2);
  });
});
