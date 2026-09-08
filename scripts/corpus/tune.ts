/**
 * Compara configuraciones del bosque aleatorio sobre una colección, con la misma validación
 * por grupos que usa la app. Imprime exactitud equilibrada por herramienta y media.
 *
 *   npx tsx scripts/corpus/tune.ts public/corpus/coleccion.json
 */
import fs from 'node:fs';
import { DatasetSchema } from '../../services/library-schema';
import { trainLocalModel, type ForestOptions } from '../../services/learning/model';
import type { TrainingSample, EffectId } from '../../services/learning/types';

const file = process.argv[2] ?? 'public/corpus/coleccion.json';
const dataset = DatasetSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
const samples: TrainingSample[] = dataset.records.map((r) => ({ id: r.id, sourceGroup: r.sourceGroup, origin: r.origin, features: r.features as TrainingSample['features'], labels: r.labels }));
const configs: { name: string; o: ForestOptions }[] = [
  { name: 'actual 40×8', o: { nEstimators: 40, maxDepth: 8 } },
  { name: '100×10', o: { nEstimators: 100, maxDepth: 10 } },
  { name: '120×12 f0.5', o: { nEstimators: 120, maxDepth: 12, maxFeatures: 0.5 } },
  { name: '160×14 f0.4', o: { nEstimators: 160, maxDepth: 14, maxFeatures: 0.4 } },
];
const effects: EffectId[] = ['pitch_shift', 'time_stretch', 'reversa', 'filtros', 'loops'];
console.log(`Colección: ${samples.length} registros\n`);
console.log('config           ' + effects.map((e) => e.padEnd(13)).join('') + 'media   tiempo');
for (const c of configs) {
  const t0 = Date.now();
  const model = trainLocalModel(samples, c.o);
  const accs = effects.map((e) => model.effects[e]?.validation.balancedAccuracy ?? 0);
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  console.log(c.name.padEnd(17) + accs.map((a) => `${(a * 100).toFixed(0).padStart(3)} %`.padEnd(13)).join('') + `${(mean * 100).toFixed(1)} %  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
