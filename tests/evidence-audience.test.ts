import { describe, expect, it } from 'vitest';
import { buildEvidence } from '../services/evidence';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';
import type { AudioEvaluation } from '../types';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);

/** Registro revisado por el profesor, con una segunda opinión suya y una lectura del estudiante. */
const reviewed = (): ReviewRecord => {
  const record = createReview('c'.repeat(64), 'entrega.wav', features);
  record.student = { name: 'Ana', submittedAt: new Date().toISOString() };
  record.labels.reversa = 'present';
  record.evidence.reversa = '0:12–0:18 cola invertida';
  record.labels.filtros = 'absent';
  record.overprocessing = 'Leve';
  record.extra = 'present';
  record.ai = assessment('pitch_shift', 'del profesor 0:05');
  record.reading = assessment('loops', 'del estudiante 0:07');
  return record;
};

const assessment = (herramienta: string, comentarios: string) => ({
  evaluacion_creatividad_y_procesamiento: { herramientas_utilizadas: [{ herramienta, detectado: true, confianza: 0.8, comentarios }] },
  puntos_extra: { detectado: false, cuales: [], comentarios: '', confianza: 0 },
}) as unknown as AudioEvaluation;

const sources = (items: { source: string }[]) => new Set(items.map(i => i.source));

describe('Quién ve cada evidencia', () => {
  it('el profesor ve las mediciones, sus decisiones y su segunda opinión', () => {
    const items = buildEvidence(reviewed(), undefined, 'teacher');
    expect(sources(items)).toEqual(new Set(['medido', 'profesor', 'modelo']));
    expect(items.find(i => i.effect === 'pitch_shift' && i.source === 'modelo')).toBeTruthy();
  });

  it('el estudiante no ve las decisiones del profesor mientras la revisión no está publicada', () => {
    const items = buildEvidence(reviewed(), undefined, 'student');
    expect(items.some(i => i.source === 'profesor')).toBe(false);
    expect(items.some(i => i.source === 'medido')).toBe(true);
  });

  it('al publicar, el estudiante ve las mismas decisiones y puntos que el profesor', () => {
    const record = { ...reviewed(), published: true };
    const teacherItems = buildEvidence(record, undefined, 'teacher').filter(i => i.source === 'profesor');
    const studentItems = buildEvidence(record, undefined, 'student').filter(i => i.source === 'profesor');
    expect(studentItems.map(i => [i.criterio, i.puntos])).toEqual(teacherItems.map(i => [i.criterio, i.puntos]));
  });

  it('cada rol ve la lectura de modelo que ha pedido, no la del otro', () => {
    const record = { ...reviewed(), published: true };
    const teacherModel = buildEvidence(record, undefined, 'teacher').filter(i => i.source === 'modelo');
    const studentModel = buildEvidence(record, undefined, 'student').filter(i => i.source === 'modelo');
    expect(teacherModel.map(i => i.effect)).toEqual(['pitch_shift']);
    expect(studentModel.map(i => i.effect)).toEqual(['loops']);
  });

  it('por defecto construye la lista del profesor', () => {
    expect(buildEvidence(reviewed()).some(i => i.source === 'profesor')).toBe(true);
  });
});
