import { openDB, type DBSchema } from 'idb';
import { calculateReview, EFFECTS, type ReviewRecord } from './review';
import type { RubricConfig } from './scoring/rubric';
import type { LocalModel } from './learning/types';
import { DatasetSchema } from './library-schema';

interface LibraryDB extends DBSchema {
  reviews: { key: string; value: ReviewRecord };
  audio: { key: string; value: Blob };
  models: { key: string; value: LocalModel };
}

export const createLibrary = (name = 'sonora-library-v1') => {
  // Open lazily: importing the app does not fail in environments without IndexedDB.
  let connection: ReturnType<typeof openDB<LibraryDB>> | undefined;
  const connect = () => connection ??= openDB<LibraryDB>(name, 1, {
    upgrade(db) { db.createObjectStore('reviews', { keyPath: 'id' }); db.createObjectStore('audio'); db.createObjectStore('models'); },
    blocking() { void connection?.then(db => db.close()); connection = undefined; },
  });
  return {
    async list() { return (await (await connect()).getAll('reviews')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async get(id: string) { return (await connect()).get('reviews', id); },
    async audio(id: string) { return (await connect()).get('audio', id); },
    async save(record: ReviewRecord, audio?: Blob) {
      const db = await connect();
      const tx = db.transaction(['reviews', 'audio'], 'readwrite');
      await tx.objectStore('reviews').put(record);
      if (audio) await tx.objectStore('audio').put(audio, record.id);
      await tx.done;
    },
    async remove(id: string) {
      const tx = (await connect()).transaction(['reviews', 'audio'], 'readwrite');
      await tx.objectStore('reviews').delete(id);
      await tx.objectStore('audio').delete(id);
      await tx.done;
    },
    async importRecords(records: ReviewRecord[]) {
      const tx = (await connect()).transaction('reviews', 'readwrite');
      let added = 0, skipped = 0;
      for (const record of records) {
        if (await tx.store.getKey(record.id)) skipped++;
        else { await tx.store.add(record); added++; }
      }
      await tx.done;
      return { added, skipped };
    },
    async model() { return (await connect()).get('models', 'current'); },
    async saveModel(model: LocalModel) { await (await connect()).put('models', model, 'current'); },
  };
};
export const library = createLibrary();
export const jsonSafe = (_key: string, value: unknown) => value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : typeof value === 'number' && Number.isNaN(value) ? null : value;

export const exportDataset = (records: ReviewRecord[]) => JSON.stringify({
  version: 1, exportedAt: new Date().toISOString(), audioIncluded: false,
  records: records.map(({ ai: _ai, ...record }) => record),
}, jsonSafe, 2);

export const parseDataset = (text: string): ReviewRecord[] => {
  if (text.length > 50 * 1024 * 1024) throw new Error('El JSON supera el límite de 50 MB.');
  try { return DatasetSchema.parse(JSON.parse(text)).records; }
  catch { throw new Error('El archivo no es una colección Sonora válida (versión 1, métricas compatibles y etiquetas completas). No se ha importado nada.'); }
};

export const downloadFile = (contents: BlobPart, name: string, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const exportCsv = (records: ReviewRecord[], rubric?: RubricConfig) => {
  const quote = (value: unknown) => {
    const raw = String(value ?? '');
    const safe = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = records.map(r => {
    const score = calculateReview(r, rubric);
    return [r.name, r.student?.name ?? '', r.student?.submittedAt ?? '', r.sourceGroup, r.origin, r.features.format.duration, ...EFFECTS.map(e => r.labels[e.id]), score.final, score.manual ? 'manual' : score.final === null ? 'pendiente' : 'calculada', score.formal.total, score.technical.total, r.notes];
  });
  return '\uFEFF' + [['Archivo', 'Estudiante', 'Entregado', 'Grupo de origen', 'Procedencia', 'Segundos', 'Pitch shift', 'Time stretch', 'Reversa', 'Filtros', 'Loops', 'Nota final', 'Tipo de nota', 'Formal', 'Técnica', 'Notas'], ...rows].map(row => row.map(quote).join(';')).join('\r\n');
};
