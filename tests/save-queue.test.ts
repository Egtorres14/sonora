import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue } from '../services/save-queue';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);
const record = (id: string, notes: string): ReviewRecord => ({ ...createReview(id.repeat(64).slice(0, 64), 'muestra.wav', features), notes });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Cola de guardado', () => {
  it('agrupa las pulsaciones seguidas sobre el mismo registro en una sola escritura', async () => {
    const saved: ReviewRecord[] = [];
    const queue = createSaveQueue(async r => { saved.push(r); }, { delayMs: 400 });
    for (const notes of ['R', 'Re', 'Rev', 'Revi']) queue.queue(record('a', notes));
    expect(saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(saved.map(r => r.notes)).toEqual(['Revi']);
  });

  it('no pierde la última pulsación aunque llegue justo después de una escritura', async () => {
    const saved: string[] = [];
    const queue = createSaveQueue(async r => { saved.push(r.notes); }, { delayMs: 400 });
    queue.queue(record('a', 'primera'));
    await vi.advanceTimersByTimeAsync(400);
    queue.queue(record('a', 'última'));
    await vi.advanceTimersByTimeAsync(400);
    expect(saved).toEqual(['primera', 'última']);
  });

  it('mantiene separados los registros distintos', async () => {
    const saved: string[] = [];
    const queue = createSaveQueue(async r => { saved.push(r.id.slice(0, 1)); }, { delayMs: 400 });
    queue.queue(record('a', 'x'));
    queue.queue(record('b', 'y'));
    await vi.advanceTimersByTimeAsync(400);
    expect(saved.sort()).toEqual(['a', 'b']);
  });

  it('flush escribe de inmediato y espera a que termine', async () => {
    const saved: string[] = [];
    const queue = createSaveQueue(async r => { saved.push(r.notes); }, { delayMs: 10_000 });
    queue.queue(record('a', 'pendiente'));
    await queue.flush();
    expect(saved).toEqual(['pendiente']);
    expect(queue.pending()).toBe(0);
  });

  it('informa del trabajo pendiente para poder avisar antes de cerrar', async () => {
    const seen: number[] = [];
    const queue = createSaveQueue(async () => {}, { delayMs: 400, onPendingChange: n => seen.push(n) });
    queue.queue(record('a', 'x'));
    expect(queue.pending()).toBe(1);
    await queue.flush();
    expect(queue.pending()).toBe(0);
    expect(seen.at(-1)).toBe(0);
  });

  it('un fallo al escribir se informa y no bloquea las escrituras siguientes', async () => {
    const errors: unknown[] = [];
    let first = true;
    const saved: string[] = [];
    const queue = createSaveQueue(async r => { if (first) { first = false; throw new Error('sin espacio'); } saved.push(r.notes); }, { delayMs: 400, onError: e => errors.push(e) });
    queue.queue(record('a', 'falla'));
    await vi.advanceTimersByTimeAsync(400);
    expect(errors).toHaveLength(1);
    queue.queue(record('a', 'después'));
    await vi.advanceTimersByTimeAsync(400);
    expect(saved).toEqual(['después']);
  });
});
