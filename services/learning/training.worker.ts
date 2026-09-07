/// <reference lib="webworker" />
import { trainLocalModel } from './model';
import type { TrainingSample } from './types';
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (event: MessageEvent<{ samples: TrainingSample[] }>) => {
  try { ctx.postMessage({ ok: true, model: trainLocalModel(event.data.samples) }); }
  catch (error) { ctx.postMessage({ ok: false, error: error instanceof Error ? error.message : 'No se pudo entrenar.' }); }
};
