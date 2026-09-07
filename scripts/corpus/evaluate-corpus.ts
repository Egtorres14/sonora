/**
 * Entrena y valida el modelo local sobre una colección exportada, sin navegador.
 * Usa exactamente el mismo código que la app (services/learning/model.ts): validación
 * en tres particiones separadas por grupo de origen.
 *
 *   npx tsx scripts/corpus/evaluate-corpus.ts [corpus/coleccion.json]
 */
import fs from 'node:fs';
import { DatasetSchema } from '../../services/library-schema';
import { trainingReadiness, trainLocalModel } from '../../services/learning/model';
import type { TrainingSample, EffectId } from '../../services/learning/types';

const file = process.argv[2] ?? 'corpus/coleccion.json';
const dataset = DatasetSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
const samples: TrainingSample[] = dataset.records.map((r) => ({ id: r.id, sourceGroup: r.sourceGroup, origin: r.origin, features: r.features as TrainingSample['features'], labels: r.labels }));

console.log(`Colección: ${samples.length} registros, ${new Set(samples.map((s) => s.sourceGroup)).size} grupos de origen, ${samples.filter((s) => s.origin === 'real').length} reales\n`);
console.log('Preparación por herramienta:');
for (const r of trainingReadiness(samples)) {
  console.log(`  ${r.effect.padEnd(13)} ${r.eligible ? 'lista' : 'NO'}  +${r.positiveSamples}/−${r.negativeSamples} muestras · grupos ${r.distinctGroups} (+${r.positiveGroups}/−${r.negativeGroups})`);
}

const t0 = Date.now();
const model = trainLocalModel(samples);
console.log(`\nEntrenado en ${((Date.now() - t0) / 1000).toFixed(1)} s · ${model.trainingSampleIds.length} muestras · ${model.trainingGroupIds.length} grupos\n`);
console.log('Validación retenida (3 particiones por grupo de origen):');
console.log('  herramienta    exact.equil.  precisión  sensibilidad  VP/VN/FP/FN   grupos');
for (const effect of Object.keys(model.effects) as EffectId[]) {
  const e = model.effects[effect]!; const v = e.validation; const c = v.confusion;
  const pct = (x: number | null) => (x === null ? '   n/a' : `${(x * 100).toFixed(0).padStart(5)} %`);
  console.log(`  ${effect.padEnd(13)} ${pct(v.balancedAccuracy)}      ${pct(v.precision)}    ${pct(v.recall)}      ${c.truePositive}/${c.trueNegative}/${c.falsePositive}/${c.falseNegative}   ${v.evaluatedGroups}`);
}
console.log('\nNota: mide si el modelo distingue estos procesos sobre estas fuentes; no es rendimiento sobre trabajos reales.');
