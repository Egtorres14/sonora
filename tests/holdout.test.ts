import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { chooseHoldout, evaluateHoldout, predictLocalModel, summarizeModel, trainLocalModel } from '../services/learning/model';
import { createLibrary } from '../services/library';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const base = extractFeatures(decodePcm(encodeWav16([new Float32Array(4800)], 48000))!);
/** 2 muestras por origen, filtros presente/ausente separable por espectro (como tests/learning.test.ts). */
const corpus = (groups = 12): ReviewRecord[] => Array.from({ length: groups * 2 }, (_, i) => {
  const positive = i % 2 === 0;
  const r = createReview(i.toString(16).padStart(64, '0'), `muestra-${i}.wav`, { ...base, spectrum: { ...base.spectrum, flatness: positive ? 0.9 : 0.1, centroidHz: positive ? 6000 : 200, ltas: base.spectrum.ltas.map((b, j) => ({ ...b, db: positive ? -j : j - 48 })) } });
  return { ...r, sourceGroup: `origen-${Math.floor(i / 2)}`, labels: { ...r.labels, filtros: positive ? 'present' as const : 'absent' as const } };
});
const groupOf = (r: ReviewRecord) => r.sourceGroup.trim().toLowerCase();

describe('Elegir el conjunto de evaluación congelado', () => {
  it('es determinista: la misma colección da el mismo conjunto', () => {
    expect(chooseHoldout(corpus()).ids).toEqual(chooseHoldout(corpus()).ids);
  });

  it('nunca parte un origen: cada grupo entra entero o no entra', () => {
    const records = corpus();
    const chosen = new Set(chooseHoldout(records).ids);
    for (const group of new Set(records.map(groupOf))) {
      const inside = records.filter(r => groupOf(r) === group).map(r => chosen.has(r.id));
      expect(new Set(inside).size).toBe(1);
    }
  });

  it('aparta alrededor de una quinta parte de los orígenes', () => {
    const set = chooseHoldout(corpus(12));
    expect(set.groups).toHaveLength(2);
    expect(set.ids).toHaveLength(4);
    expect(chooseHoldout(corpus(20)).groups).toHaveLength(4);
  });

  it('ignora demos y registros sin origen', () => {
    const records = [...corpus(10), { ...corpus(1)[0], id: 'f'.repeat(64), origin: 'synthetic' as const, sourceGroup: 'demo' }, { ...corpus(1)[1], id: 'e'.repeat(64), sourceGroup: '' }];
    const set = chooseHoldout(records);
    expect(set.groups).not.toContain('demo');
    expect(set.ids).not.toContain('f'.repeat(64));
    expect(set.ids).not.toContain('e'.repeat(64));
  });

  it('exige orígenes suficientes para que el entrenamiento no se quede sin ellos', () => {
    expect(() => chooseHoldout(corpus(7))).toThrow(/8 orígenes/);
    expect(() => chooseHoldout(corpus(8))).not.toThrow();
  });

  it('deja fecha y grupos elegidos', () => {
    const set = chooseHoldout(corpus());
    expect(Date.parse(set.chosenAt)).not.toBeNaN();
    expect(set.groups.every(g => g.startsWith('origen-'))).toBe(true);
  });
});

describe('Medir un modelo sobre el conjunto congelado', () => {
  const split = () => {
    const records = corpus(12);
    const set = chooseHoldout(records);
    const held = new Set(set.ids);
    return { training: records.filter(r => !held.has(r.id)), holdout: records.filter(r => held.has(r.id)) };
  };

  it('devuelve métricas por herramienta entrenada, sin abstenerse', () => {
    const { training, holdout } = split();
    const model = trainLocalModel(training);
    const result = evaluateHoldout(model, holdout);
    const filtros = result.filtros!;
    const c = filtros.confusion;
    expect(c.truePositive + c.trueNegative + c.falsePositive + c.falseNegative).toBe(holdout.length);
    expect(filtros.evaluatedSamples).toBe(holdout.length);
    expect(filtros.evaluatedGroups).toBe(2);
    expect(filtros.folds).toBe(0);
    expect(filtros.balancedAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(result.reversa).toBeUndefined();
  });

  it('solo cuenta muestras reales con etiqueta decidida', () => {
    const { training, holdout } = split();
    const model = trainLocalModel(training);
    const unlabeled = holdout.map((r, i) => (i === 0 ? { ...r, labels: { ...r.labels, filtros: 'unknown' as const } } : r));
    expect(evaluateHoldout(model, unlabeled).filtros!.evaluatedSamples).toBe(holdout.length - 1);
  });

  it('sin muestras evaluables no inventa una métrica', () => {
    const { training } = split();
    expect(evaluateHoldout(trainLocalModel(training), []).filtros).toBeUndefined();
  });

  it('el modelo sigue sirviendo tras el clonado estructurado del worker y de IndexedDB', () => {
    // toJSON() del bosque dejaba instancias (Matrix, Float64Array) que el clonado convertía en objetos planos.
    const { training, holdout } = split();
    const cloned = structuredClone(trainLocalModel(training));
    expect(evaluateHoldout(cloned, holdout).filtros!.balancedAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(() => predictLocalModel(cloned, holdout[0].features)).not.toThrow();
  });

  it('el resumen del entrenamiento conserva la medición congelada', () => {
    const { training, holdout } = split();
    const model = trainLocalModel(training);
    model.holdout = evaluateHoldout(model, holdout);
    expect(summarizeModel(model).holdout?.filtros?.balancedAccuracy).toBe(model.holdout.filtros!.balancedAccuracy);
  });
});

describe('El conjunto congelado se guarda con la biblioteca', () => {
  it('sobrevive a reabrir el almacenamiento', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = createLibrary(name);
    const set = chooseHoldout(corpus());
    await first.saveHoldout(set);
    expect(await createLibrary(name).holdout()).toEqual(set);
  });

  it('se puede borrar', async () => {
    const db = createLibrary(`test-${crypto.randomUUID()}`);
    await db.saveHoldout(chooseHoldout(corpus()));
    await db.clearHoldout();
    expect(await db.holdout()).toBeUndefined();
  });

  it('una biblioteca anterior se abre sin conjunto y sin perder las muestras', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = createLibrary(name);
    await first.save({ ...corpus(1)[0], notes: 'Revisado' });
    const reopened = createLibrary(name);
    expect(await reopened.holdout()).toBeUndefined();
    expect((await reopened.list())[0].notes).toBe('Revisado');
  });
});
