/// <reference lib="webworker" />
/**
 * Web Worker: decodifica (WAV/AIFF PCM) y extrae características sin bloquear la UI.
 */
import { decodePcm } from './wav';
import { extractFeatures, type AudioFeatures } from './features';

export type WorkerRequest =
  | { type: 'decode-and-analyze'; buffer: ArrayBuffer; fileName: string; sizeBytes: number }
  | {
      type: 'analyze';
      channels: Float32Array[];
      sampleRate: number;
      bitDepth: number;
      sampleFormat: 'int' | 'float' | 'unknown';
      container: 'wav' | 'aiff' | 'other';
      decoder: 'native-pcm' | 'webaudio';
      fileName: string;
      sizeBytes: number;
    };

export type WorkerResponse =
  | { ok: true; features: AudioFeatures; channels: Float32Array[]; sampleRate: number; bitDepth: number; sampleFormat: 'int' | 'float' | 'unknown'; duration: number }
  | { ok: false; unsupported: true }
  | { ok: false; unsupported?: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'decode-and-analyze') {
      const decoded = decodePcm(msg.buffer);
      if (!decoded) { ctx.postMessage({ ok: false, unsupported: true } satisfies WorkerResponse); return; }
      const features = extractFeatures(decoded, { fileName: msg.fileName, sizeBytes: msg.sizeBytes });
      const res: WorkerResponse = { ok: true, features, channels: decoded.channels, sampleRate: decoded.sampleRate, bitDepth: decoded.bitDepth, sampleFormat: decoded.sampleFormat, duration: decoded.duration };
      ctx.postMessage(res, decoded.channels.map((c) => c.buffer));
      return;
    }
    const length = msg.channels[0]?.length ?? 0;
    const features = extractFeatures(
      { channels: msg.channels, sampleRate: msg.sampleRate, bitDepth: msg.bitDepth, sampleFormat: msg.sampleFormat, length, duration: length / msg.sampleRate, container: msg.container, decoder: msg.decoder },
      { fileName: msg.fileName, sizeBytes: msg.sizeBytes },
    );
    const res: WorkerResponse = { ok: true, features, channels: msg.channels, sampleRate: msg.sampleRate, bitDepth: msg.bitDepth, sampleFormat: msg.sampleFormat, duration: length / msg.sampleRate };
    ctx.postMessage(res, msg.channels.map((c) => c.buffer));
  } catch (error) {
    ctx.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
};
