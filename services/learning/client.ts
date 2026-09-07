import type { TrainingSample, LocalModel } from './types';
export const trainInWorker = (samples: TrainingSample[], signal?: AbortSignal): Promise<LocalModel> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Entrenamiento cancelado.', 'AbortError')); return; }
  const worker = new Worker(new URL('./training.worker.ts', import.meta.url), { type: 'module' });
  const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
  const abort = () => { cleanup(); reject(new DOMException('Entrenamiento cancelado.', 'AbortError')); };
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = event => { cleanup(); event.data.ok ? resolve(event.data.model) : reject(new Error(event.data.error)); };
  worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Error en el entrenamiento local.')); };
  try { worker.postMessage({ samples }); } catch (error) { cleanup(); reject(error); }
});
