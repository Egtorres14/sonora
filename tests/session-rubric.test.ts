import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeStudentName, studentKey, setTeacherPin, verifyTeacherPin, hasCustomTeacherPin, clearTeacherPin, saveSession, loadSession, clearSession, studentSession } from '../services/session';
import { loadRubric, saveRubric, resetRubric, fromStored, toStored, rubricTotal, isDefaultRubric } from '../services/rubric-store';
import { DEFAULT_RUBRIC } from '../services/scoring/rubric';
import { calculateReview, createReview } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

describe('Sesión de acceso', () => {
  beforeEach(() => { clearSession(); clearTeacherPin(); });
  it('normaliza y valida el nombre del estudiante', () => {
    expect(normalizeStudentName('  María   Pérez ')).toBe('María Pérez');
    expect(() => normalizeStudentName('a')).toThrow();
    expect(() => normalizeStudentName('1234')).toThrow();
    expect(studentKey('María Pérez')).toBe(studentKey('maria  perez'));
  });
  it('el PIN acordado funciona por defecto y un PIN propio lo sustituye', async () => {
    expect(hasCustomTeacherPin()).toBe(false);
    expect(await verifyTeacherPin('Felipebolano2026')).toBe(true);
    expect(await verifyTeacherPin('otro')).toBe(false);
    await expect(setTeacherPin('123')).rejects.toThrow();
    await setTeacherPin('clase-2026');
    expect(hasCustomTeacherPin()).toBe(true);
    expect(await verifyTeacherPin('clase-2026')).toBe(true);
    expect(await verifyTeacherPin('Felipebolano2026')).toBe(false);
  });
  it('la sesión de estudiante persiste con su nombre normalizado', () => {
    saveSession(studentSession(' Ana  López '));
    expect(loadSession()).toMatchObject({ role: 'student', studentName: 'Ana López' });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});

describe('Rúbrica editable', () => {
  beforeEach(() => resetRubric());
  it('por defecto devuelve la rúbrica original y la reconoce como tal', () => {
    expect(loadRubric()).toEqual(DEFAULT_RUBRIC);
    expect(isDefaultRubric(loadRubric())).toBe(true);
    expect(rubricTotal(DEFAULT_RUBRIC)).toBe(30);
  });
  it('guarda, recalcula el total y conserva el tramo abierto de clics', () => {
    const custom = saveRubric({ ...DEFAULT_RUBRIC, technical: { ...DEFAULT_RUBRIC.technical, maxPoints: 15, requiredSampleRate: null }, creative: { ...DEFAULT_RUBRIC.creative, requiredTools: ['reversa', 'filtros'], missingToolPenalty: 4 } });
    expect(custom.totalPoints).toBe(32.5);
    expect(loadRubric().creative.requiredTools).toEqual(['reversa', 'filtros']);
    expect(loadRubric().technical.clickTiers.at(-1)!.maxClicks).toBe(Infinity);
    expect(isDefaultRubric(loadRubric())).toBe(false);
  });
  it('rechaza valores inválidos y no altera lo guardado', () => {
    expect(() => saveRubric({ ...DEFAULT_RUBRIC, bonus: { points: -1, minConfidence: 0.5 } })).toThrow();
    expect(() => fromStored({ ...toStored(DEFAULT_RUBRIC), technical: { ...toStored(DEFAULT_RUBRIC).technical, duration: { minSec: 70, maxSec: 60, penalty: 1 } } })).toThrow();
    expect(loadRubric()).toEqual(DEFAULT_RUBRIC);
  });
  it('calculateReview aplica la rúbrica personalizada', () => {
    const sr = 48000;
    const wav = encodeWav16([Float32Array.from({ length: sr * 60 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / sr) * 0.1)], sr);
    const record = createReview('a'.repeat(64), 'campana_bosque.wav', extractFeatures(decodePcm(wav)!));
    record.synopsis = 'Paisaje sonoro construido a partir de una campana.';
    record.labels = { pitch_shift: 'present', time_stretch: 'present', reversa: 'absent', filtros: 'present', loops: 'unknown' };
    record.overprocessing = 'none'; record.extra = 'absent';
    expect(calculateReview(record).final).toBe(27.5);
    const custom = { ...DEFAULT_RUBRIC, creative: { ...DEFAULT_RUBRIC.creative, requiredTools: ['pitch_shift', 'time_stretch', 'filtros'] as const, missingToolPenalty: 1 } };
    const score = calculateReview(record, { ...custom, creative: { ...custom.creative, requiredTools: [...custom.creative.requiredTools] } });
    expect(score.final).toBe(30);
    expect(score.maxTotal).toBe(30);
  });
});
