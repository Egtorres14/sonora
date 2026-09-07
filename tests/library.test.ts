import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLibrary, exportDataset, parseDataset } from '../services/library';
import { createReview } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);
const record = () => createReview('b'.repeat(64), 'silencio.wav', features);
describe('Biblioteca de muestras', () => {
  it('mantiene audio y correcciones al volver a abrir el almacenamiento', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = createLibrary(name);
    await first.save({ ...record(), notes: 'Revisado', sourceGroup: 'campana-01' }, new Blob(['audio']));
    const reopened = createLibrary(name);
    expect((await reopened.list())[0].notes).toBe('Revisado');
    expect(await (await reopened.audio(record().id))?.text()).toBe('audio');
  });
  it('importa atómicamente y no sobrescribe etiquetas de un duplicado', async () => {
    const db = createLibrary(`test-${crypto.randomUUID()}`);
    await db.save({ ...record(), notes: 'Corrección local' });
    expect(await db.importRecords([record(), record()])).toEqual({ added: 0, skipped: 2 });
    expect((await db.list())[0].notes).toBe('Corrección local');
  });
  it('rechaza métricas ausentes, etiquetas inválidas y versiones desconocidas', () => {
    expect(() => parseDataset(JSON.stringify({ version: 99, records: [] }))).toThrow();
    const bad = JSON.parse(exportDataset([record()]));
    bad.records[0].features.format.sampleRate = -20;
    expect(() => parseDataset(JSON.stringify(bad))).toThrow();
    bad.records[0] = { ...record(), labels: { ...record().labels, reversa: 'inventado' } };
    expect(() => parseDataset(JSON.stringify(bad))).toThrow();
  });
  it('preserva la procedencia sintética y el silencio al exportar e importar', () => {
    const restored = parseDataset(exportDataset([{ ...record(), origin: 'synthetic' }]));
    expect(restored[0].origin).toBe('synthetic');
    expect(restored[0].features.levels.integratedLufs).toBe(-Infinity);
  });
  it('conserva el signo del balance cuando un canal está en silencio', () => {
    const r = record();
    r.features = { ...features, stereo: { correlation: 0, balanceDb: Infinity, sideToMidDb: -Infinity, isDualMono: false } };
    const restored = parseDataset(exportDataset([r]))[0];
    expect(restored.features.stereo!.balanceDb).toBe(Infinity);
    expect(restored.features.stereo!.sideToMidDb).toBe(-Infinity);
  });
});
