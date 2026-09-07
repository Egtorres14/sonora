/**
 * Prepara la copia de audio que se envía al modelo: mezcla mono, remuestreo a 16 kHz
 * (lo que Gemini procesa internamente; OpenAI no documenta más), normalización de pico y WAV PCM16.
 * Un minuto pasa de ~17 MB (48 kHz/24 bit/estéreo) a ~1.9 MB y cabe holgadamente en los límites inline.
 * Solo navegador (OfflineAudioContext).
 */
import { downmixMono } from './dsp';
import { encodeWav16 } from './wav';
import type { ModelAudio } from '../llm/types';

export const arrayBufferToBase64 = (buffer: ArrayBuffer): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result.split(',')[1] ?? '' : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([buffer]));
  });

export const resampleMono = async (mono: Float32Array, fromRate: number, toRate: number): Promise<Float32Array> => {
  if (fromRate === toRate) return mono;
  const length = Math.ceil((mono.length * toRate) / fromRate);
  const ctx = new OfflineAudioContext(1, length, toRate);
  const buffer = ctx.createBuffer(1, mono.length, fromRate);
  buffer.copyToChannel(mono, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
};

export const prepareModelAudio = async (channels: Float32Array[], sampleRate: number, targetRate = 16000, normalizePeakDb = -1): Promise<ModelAudio> => {
  const mono = downmixMono(channels);
  const resampled = await resampleMono(mono, sampleRate, targetRate);
  let peak = 0;
  for (let i = 0; i < resampled.length; i++) { const a = Math.abs(resampled[i]); if (a > peak) peak = a; }
  const out = new Float32Array(resampled.length);
  const gain = peak > 0 ? Math.min(Math.pow(10, normalizePeakDb / 20) / peak, 100) : 1; // máximo +40 dB
  for (let i = 0; i < resampled.length; i++) out[i] = resampled[i] * gain;
  const wav = encodeWav16([out], targetRate);
  return {
    base64: await arrayBufferToBase64(wav),
    mimeType: 'audio/wav',
    sampleRate: targetRate,
    channels: 1,
    durationSec: out.length / targetRate,
    bytes: wav.byteLength,
  };
};
