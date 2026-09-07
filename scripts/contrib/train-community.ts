/**
 * Entrena el modelo comunitario en CI con una o varias colecciones (corpus base + contribuciones),
 * deduplicando por id, y escribe:
 *   corpus-out/community-model.json   modelo serializado (mismo formato que guarda la app)
 *   corpus-out/VALIDACION-CI.md       tabla de validación por grupos de origen
 *
 *   npx tsx scripts/contrib/train-community.ts corpus/coleccion.json corpus/contributions/*.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatasetSchema } from '../../services/library-schema';
import { trainingReadiness, trainLocalModel } from '../../services/learning/model';
import type { TrainingSample, EffectId } from '../../services/learning/types';

const files = process.argv.slice(2).filter((f) => fs.existsSync(f));
if (files.length === 0) throw new Error('No hay colecciones que cargar.');
const seen = new Set<string>();
const samples: TrainingSample[] = [];
const perFile: string[] = [];
for (const file of files) {
  const parsed = DatasetSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) { perFile.push(`- \`${file}\`: ignorado, no cumple el esquema.`); continue; }
  let added = 0;
  for (const r of parsed.data.records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id); added++;
    samples.push({ id: r.id, sourceGroup: r.sourceGroup, origin: r.origin, features: r.features as TrainingSample['features'], labels: r.labels });
  }
  perFile.push(`- \`${file}\`: ${added} registros nuevos.`);
}

const readiness = trainingReadiness(samples);
const t0 = Date.now();
const model = trainLocalModel(samples);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)} %`);
const rows = (Object.keys(model.effects) as EffectId[]).map((effect) => {
  const v = model.effects[effect]!.validation, c = v.confusion;
  return `| ${effect} | ${pct(v.balancedAccuracy)} | ${pct(v.precision)} | ${pct(v.recall)} | ${c.truePositive}/${c.trueNegative}/${c.falsePositive}/${c.falseNegative} | ${v.evaluatedGroups} |`;
});
const notReady = readiness.filter((r) => !r.eligible).map((r) => `- ${r.effect}: ${r.reason} (+${r.positiveSamples}/−${r.negativeSamples}, grupos ${r.distinctGroups})`);
const md = `## Modelo comunitario · ${new Date().toISOString().slice(0, 10)}

Colecciones: ${files.length} · registros únicos: ${samples.length} · reales: ${samples.filter((s) => s.origin === 'real').length} · grupos de origen: ${new Set(samples.map((s) => s.sourceGroup.trim().toLowerCase())).size} · entrenamiento ${elapsed} s · descriptores \`${model.featureVersion}\`

${perFile.join('\n')}

| herramienta | exactitud equilibrada | precisión | sensibilidad | VP/VN/FP/FN | grupos |
|---|---|---|---|---|---|
${rows.join('\n')}
${notReady.length ? `\nSin datos suficientes:\n${notReady.join('\n')}\n` : ''}
Validación en 3 particiones separadas por grabación de origen (ningún origen a ambos lados). Mide separabilidad sobre este corpus, no rendimiento sobre trabajos reales.
`;

fs.mkdirSync('corpus-out', { recursive: true });
fs.writeFileSync(path.join('corpus-out', 'community-model.json'), JSON.stringify(model));
fs.writeFileSync(path.join('corpus-out', 'VALIDACION-CI.md'), md);
console.log(md);
