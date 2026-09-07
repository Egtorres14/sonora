/**
 * API de análisis para la UI: decodifica el archivo en su frecuencia de muestreo nativa
 * y extrae características en un Web Worker. Para formatos comprimidos utiliza
 * Web Audio a la tasa original; un fallo no inicia DSP pesado en el hilo de la UI.
 */
import { parseAudioHeader } from './wav';
import type { AudioFeatures } from './features';
import type { WorkerRequest, WorkerResponse } from './analysis.worker';

export interface AnalyzedAudio {
  channels: Float32Array[];
  sampleRate: number;
  bitDepth: number;
  sampleFormat: 'int' | 'float' | 'unknown';
  duration: number;
  features: AudioFeatures;
}

export type StageCallback = (stage: string) => void;

const runWorker = (req: WorkerRequest, transfer: Transferable[], signal?: AbortSignal): Promise<WorkerResponse> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Análisis cancelado.', 'AbortError')); return; }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) { reject(e); return; }
    const cleanup = () => { worker.terminate(); clearTimeout(timeout); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Análisis cancelado.', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('El análisis ha superado el tiempo disponible. Usa una muestra más corta.')); }, 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => { cleanup(); resolve(e.data); };
    worker.onerror = (e) => { cleanup(); reject(new Error(e.message || 'Fallo en el worker de análisis')); };
    try { worker.postMessage(req, transfer); } catch (error) { cleanup(); reject(error); }
  });

const unwrap = (res: WorkerResponse): AnalyzedAudio | 'unsupported' => {
  if (res.ok === true) return { channels: res.channels, sampleRate: res.sampleRate, bitDepth: res.bitDepth, sampleFormat: res.sampleFormat, duration: res.duration, features: res.features };
  if ('unsupported' in res && res.unsupported === true) return 'unsupported';
  throw new Error('error' in res ? res.error : 'Fallo desconocido en el worker de análisis');
};

const decodeWithWebAudio = async (buffer: ArrayBuffer, preferredRate: number) => {
  const AC = (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext) as typeof OfflineAudioContext;
  let ctx: OfflineAudioContext;
  try { ctx = new AC(1, 1, preferredRate); }
  catch { throw new Error('El navegador no admite la frecuencia original. Exporta una copia WAV PCM para analizarla sin remuestreo.'); }
  const audio = await ctx.decodeAudioData(buffer.slice(0));
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c).slice());
  return { channels, sampleRate: audio.sampleRate };
};

export const analyzeFile = async (file: File, onStage?: StageCallback, signal?: AbortSignal): Promise<AnalyzedAudio> => {
  onStage?.('Leyendo el archivo…');
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Análisis cancelado.', 'AbortError');
  const header = parseAudioHeader(buffer);
  if (!header) throw new Error('No se reconoce una cabecera WAV, AIFF o FLAC válida.');

  onStage?.('Decodificando y midiendo (worker)…');
  const res = await runWorker({ type: 'decode-and-analyze', buffer, fileName: file.name, sizeBytes: file.size }, [], signal);
  const decoded = unwrap(res);
  if (decoded !== 'unsupported') return decoded;

  // Formato no PCM (o AIFC comprimido): decodificar con Web Audio en la tasa de la cabecera si es posible
  onStage?.('Formato no PCM: decodificando con Web Audio…');
  const { channels, sampleRate } = await decodeWithWebAudio(buffer, header.sampleRate);
  const req: WorkerRequest = {
    type: 'analyze', channels, sampleRate, bitDepth: header?.bitDepth ?? 0, sampleFormat: header?.sampleFormat ?? 'unknown',
    container: header?.container ?? 'other', decoder: 'webaudio', fileName: file.name, sizeBytes: file.size,
  };
  const out = unwrap(await runWorker(req, [], signal));
  if (out === 'unsupported') throw new Error('El formato no se puede analizar en este navegador.');
  return out;
};
