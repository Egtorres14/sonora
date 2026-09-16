/**
 * Marcas del profesor sobre el audio: dónde ocurre cada herramienta de la rúbrica.
 *
 * Las operaciones devuelven el parche completo del registro en vez de mutarlo, para que la marca y
 * la etiqueta que propone viajen en un solo `onChange`: así el registro nunca queda a medias entre
 * dos escrituras y la cola de guardado (services/save-queue.ts) escribe una vez.
 */
import type { ToolId } from './scoring/rubric';
import type { EffectLabels, ReviewRecord } from './review';

export interface AudioMark {
  id: string;
  effect: ToolId;
  start: number;
  end: number;
  note: string;
  createdAt: string;
}

/** Por debajo de esto una marca no señala nada: es un clic accidental. */
export const MIN_MARK_SECONDS = 0.05;
export const MAX_MARKS = 200;
export const MAX_NOTE = 2000;

/** Color por herramienta. Nunca es la única señal: cada marca lleva además su nombre escrito. */
export const EFFECT_COLOR: Record<ToolId, string> = {
  pitch_shift: 'rgba(199,235,153,.34)',
  time_stretch: 'rgba(228,176,123,.34)',
  reversa: 'rgba(129,212,250,.34)',
  filtros: 'rgba(206,147,216,.34)',
  loops: 'rgba(255,213,79,.34)',
};

export interface MarkPatch { patch: Partial<ReviewRecord>; proposedLabel: ToolId | null }

const clampRange = (start: number, end: number, duration: number) => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('La marca necesita un inicio y un final válidos.');
  const limit = Math.max(Number.isFinite(duration) ? duration : 0, MIN_MARK_SECONDS);
  const lo = Math.min(start, end), hi = Math.max(start, end);
  const s = Math.min(Math.max(0, lo), limit - MIN_MARK_SECONDS);
  const e = Math.min(Math.max(s + MIN_MARK_SECONDS, hi), limit);
  return { start: +s.toFixed(3), end: +e.toFixed(3) };
};

const sorted = (marks: AudioMark[]) => [...marks].sort((a, b) => a.start - b.start || a.effect.localeCompare(b.effect));

export const createMark = (effect: ToolId, start: number, end: number, duration: number): AudioMark => ({
  id: crypto.randomUUID(), effect, ...clampRange(start, end, duration), note: '', createdAt: new Date().toISOString(),
});

export const marksFor = (record: ReviewRecord, effect: ToolId): AudioMark[] => (record.marks ?? []).filter(m => m.effect === effect);

export const addMark = (record: ReviewRecord, mark: AudioMark): MarkPatch => {
  const current = record.marks ?? [];
  if (current.length >= MAX_MARKS) throw new Error(`Una muestra admite como mucho ${MAX_MARKS} marcas. Borra alguna antes de añadir otra.`);
  const marks = sorted([...current, mark]);
  // Solo se propone cuando la herramienta seguía pendiente: una decisión ya tomada es del profesor.
  const propose = record.labels[mark.effect] === 'unknown';
  return {
    patch: propose ? { marks, labels: { ...record.labels, [mark.effect]: 'present' } as EffectLabels } : { marks },
    proposedLabel: propose ? mark.effect : null,
  };
};

export const updateMark = (record: ReviewRecord, id: string, changes: Partial<Pick<AudioMark, 'start' | 'end' | 'note'>>, duration: number): MarkPatch => {
  const current = record.marks ?? [];
  const target = current.find(m => m.id === id);
  if (!target) return { patch: {}, proposedLabel: null };
  const range = changes.start !== undefined || changes.end !== undefined
    ? clampRange(changes.start ?? target.start, changes.end ?? target.end, duration)
    : { start: target.start, end: target.end };
  const note = changes.note !== undefined ? changes.note.slice(0, MAX_NOTE) : target.note;
  return { patch: { marks: sorted(current.map(m => m.id === id ? { ...m, ...range, note } : m)) }, proposedLabel: null };
};

/** Borrar quita evidencia, no una decisión: la etiqueta no se toca nunca. */
export const removeMark = (record: ReviewRecord, id: string): MarkPatch =>
  ({ patch: { marks: (record.marks ?? []).filter(m => m.id !== id) }, proposedLabel: null });
